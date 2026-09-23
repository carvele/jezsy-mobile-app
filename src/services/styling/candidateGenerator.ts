import {
  WardrobeItem,
  CandidateOutfit,
  StylingIntent,
  CandidateGeneratorConfig,
  DEFAULT_GENERATOR_CONFIG,
} from '@/src/types/styleAdvisor';
import {
  resolveEffectiveGarmentBucket,
  resolveAccessorySubtype,
} from '@/src/utils/garmentSemanticClassifier';
import { evaluateColors } from '@/src/utils/colorMatcher';
import { computePersonalAffinity } from '@/src/utils/personalStyleEngine';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import {
  interpretOutfitContext,
  buildGarmentSemanticProfile,
  buildOccasionRequirements,
  buildOutfitStructure,
  detectContradictions,
  evaluateWardrobeOutfit,
} from '@/src/utils/aiStylistAdvisor';

function toCanvasShim(item: WardrobeItem) {
  return {
    wardrobe_item_id: item.id,
    garment_type: item.category || item.garment_type || '',
    name: item.sub_category || item.category || (item as any).name || 'Item',
    image_url: (item as any).photo_url || item.image_url || '',
    id: item.id,
  } as any;
}

function neglect(item: WardrobeItem, neglectDays = 60): number {
  if (!item.wear_count) return 1;
  if (!item.last_worn_at) return 0.6;
  const days = (Date.now() - new Date(item.last_worn_at).getTime()) / 86_400_000;
  return Math.max(0, Math.min(1, days / neglectDays));
}

function colorsOf(items: WardrobeItem[]): string[] {
  return items.flatMap((i) => i.color_tags || []);
}

export type ScoringProfile = 'intent-driven' | 'legacy-passive';

export interface CandidateGenerationOptions {
  limit?: number;
  profile?: UserStyleProfileDto | null;
  /** Configurable scoring profile for empirical characterization */
  scoringProfile?: ScoringProfile;
  /** Configurable generation bounds */
  config?: Partial<CandidateGeneratorConfig>;
}

/**
 * Builds a bounded pool of verified, wardrobe-grounded candidate outfits satisfying user constraints.
 * Canonical two-stage implementation for Style Advisor, passive discovery, and Mannequin smart shuffle.
 */
export function generateCandidateOutfits(
  wardrobe: WardrobeItem[],
  intent: StylingIntent,
  options?: CandidateGenerationOptions
): CandidateOutfit[] {
  if (!wardrobe || wardrobe.length === 0) return [];

  const limit = options?.limit || 10;
  const profile = options?.profile || null;
  const scoringProfile: ScoringProfile = options?.scoringProfile || 'intent-driven';
  const config: CandidateGeneratorConfig = {
    ...DEFAULT_GENERATOR_CONFIG,
    ...(options?.config || {}),
  };
  const PER_SLOT_MAX = config.perSlotMax;

  // 1. Must-use item existence check:
  // If must-use constraint was provided but requested item is not in wardrobe (or deleted),
  // return empty result to distinguish constraint failure from unconstrained generation.
  // Never fabricate an item.
  const mustUseIds = intent.mustUseItemIds || [];
  if (mustUseIds.length > 0) {
    const wardrobeIdSet = new Set(wardrobe.map((i) => i.id));
    const allFound = mustUseIds.every((id) => wardrobeIdSet.has(id));
    if (!allFound) {
      return [];
    }
  }
  const mustUseItems = wardrobe.filter((i) => mustUseIds.includes(i.id));
  const mustUseAccessories = mustUseItems.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory');
  const mustUseCore = mustUseItems.filter((i) => resolveEffectiveGarmentBucket(i) !== 'Accessory');

  // 2. Hard exclusions:
  // Explicit excluded items AND explicit avoided colors are strict constraints.
  // Never use an avoided color merely because a category would otherwise be empty.
  const excludedSet = new Set(intent.excludedItemIds || []);
  const avoidedColorSet = new Set((intent.avoidedColors || []).map((c) => c.toLowerCase()));

  const filteredWardrobe = wardrobe.filter((item) => {
    if (excludedSet.has(item.id)) return false;
    if (avoidedColorSet.size > 0 && item.color_tags && item.color_tags.length > 0) {
      const itemColors = item.color_tags.map((c) => c.toLowerCase());
      if (itemColors.some((c) => avoidedColorSet.has(c))) {
        // Strict exclusion: never violate explicit avoided color
        return false;
      }
    }
    return true;
  });

  if (filteredWardrobe.length === 0) return [];

  // 3. Prepare occasion requirements for contradiction filtering
  const contextInterp = interpretOutfitContext({
    occasion: intent.selectedOccasion || intent.rawPrompt || 'Casual',
    additionalContext: intent.rawPrompt,
  });
  const reqs = buildOccasionRequirements(contextInterp);

  // 4. Partition eligible core items by slot
  const getSlotPool = (slotType: string): WardrobeItem[] => {
    const items = filteredWardrobe.filter((i) => resolveEffectiveGarmentBucket(i) === slotType);
    items.sort((a, b) => neglect(b, config.neglectDays) - neglect(a, config.neglectDays));

    const compatible: WardrobeItem[] = [];
    const fallback: WardrobeItem[] = [];

    for (const it of items) {
      const gProfile = buildGarmentSemanticProfile(toCanvasShim(it), it);
      const structure = buildOutfitStructure([gProfile]);
      const contradictions = detectContradictions([gProfile], reqs, structure);
      const hasSevere = contradictions.some((c) => c.severity === 'severe');
      if (hasSevere) {
        fallback.push(it);
      } else {
        compatible.push(it);
      }
    }

    const chosen = compatible.length > 0 ? compatible : fallback;
    const pool = chosen.slice(0, PER_SLOT_MAX);
    // Ensure any must-use item of this slot is present in the pool
    for (const m of mustUseCore) {
      if (resolveEffectiveGarmentBucket(m) === slotType && !pool.some((p) => p.id === m.id)) {
        pool.unshift(m);
      }
    }
    return pool;
  };

  const tops = getSlotPool('Top');
  const bottoms = getSlotPool('Bottom');
  const dresses = getSlotPool('Dress');
  const shoes = getSlotPool('Shoes');
  const outerwear = getSlotPool('Outerwear');

  // =========================================================================
  // STAGE 1: Core Base & Silhouette Generation with Must-Use Co-Pruning
  // =========================================================================
  const bases: WardrobeItem[][] = [];
  for (const d of dresses) {
    bases.push([d]);
  }
  for (const t of tops) {
    for (const b of bottoms) {
      bases.push([t, b]);
    }
  }

  if (bases.length === 0) return [];

  const rawCoreCombos: WardrobeItem[][] = [];
  for (const base of bases) {
    const withShoes = shoes.length > 0 ? shoes.map((s) => [...base, s]) : [base];
    for (const combo of withShoes) {
      rawCoreCombos.push(combo);
      // Layering: add up to 2 outerwear options if available
      for (const o of outerwear.slice(0, 2)) {
        rawCoreCombos.push([...combo, o]);
      }
    }
  }

  // Filter core combinations against must-use core items
  let eligibleCoreCombos = rawCoreCombos;
  if (mustUseCore.length > 0) {
    const mustUseCoreIds = mustUseCore.map((i) => i.id);
    eligibleCoreCombos = rawCoreCombos.filter((combo) => {
      const comboIds = new Set(combo.map((i) => i.id));
      return mustUseCoreIds.every((mId) => comboIds.has(mId));
    });

    if (eligibleCoreCombos.length === 0) {
      // Synthetic core injection for must-use core items
      const syntheticCombos: WardrobeItem[][] = [];
      for (const base of bases) {
        let combo = [...base];
        for (const mItem of mustUseCore) {
          const mBucket = resolveEffectiveGarmentBucket(mItem);
          combo = combo.filter((i) => resolveEffectiveGarmentBucket(i) !== mBucket);
          combo.push(mItem);
        }
        if (shoes.length > 0 && !combo.some((i) => resolveEffectiveGarmentBucket(i) === 'Shoes')) {
          combo.push(shoes[0]);
        }
        syntheticCombos.push(combo);
      }
      eligibleCoreCombos = syntheticCombos.filter((combo) => {
        const comboIds = new Set(combo.map((i) => i.id));
        return mustUseCoreIds.every((mId) => comboIds.has(mId));
      });
    }
  }

  if (mustUseCore.length > 0 && eligibleCoreCombos.length === 0) {
    return [];
  }

  // STAGE-1 MUST-USE ACCESSORY CO-PRUNING:
  // If an accessory is required/locked, evaluate core candidate compatibility immediately.
  // Cores that contradict a required accessory (e.g. running shorts with formal belt) are pruned.
  if (mustUseAccessories.length > 0) {
    eligibleCoreCombos = eligibleCoreCombos.filter((coreCombo) => {
      const combined = [...coreCombo, ...mustUseAccessories];
      const gProfiles = combined.map((item) => buildGarmentSemanticProfile(toCanvasShim(item), item));
      const structure = buildOutfitStructure(gProfiles);
      const contradictions = detectContradictions(gProfiles, reqs, structure);
      return !contradictions.some((c) => c.severity === 'severe');
    });

    if (eligibleCoreCombos.length === 0) {
      // Grounded no-match: locked accessory contradicts all available wardrobe core combinations
      return [];
    }
  }

  // Filter out core combinations that have severe contradictions on their own
  const validCoreCombos = eligibleCoreCombos.filter((combo) => {
    const garmentProfiles = combo.map((item) => buildGarmentSemanticProfile(toCanvasShim(item), item));
    const structure = buildOutfitStructure(garmentProfiles);
    const contradictions = detectContradictions(garmentProfiles, reqs, structure);
    return !contradictions.some((c) => c.severity === 'severe');
  });

  const survivingCorePool = validCoreCombos.length > 0 ? validCoreCombos : eligibleCoreCombos;
  if (survivingCorePool.length === 0) return [];

  // Helper to score a core combination
  const scoreCoreCombo = (items: WardrobeItem[]): { score: number; colorMatch: any; personal: any } => {
    const colors = colorsOf(items);
    const colorMatch = evaluateColors(colors);
    const personal = computePersonalAffinity(items, profile, intent.selectedOccasion);
    const types = items.map((i) => resolveEffectiveGarmentBucket(i));
    const hasDress = types.includes('Dress');
    const hasShoes = types.includes('Shoes');
    const hasOuterwear = types.includes('Outerwear');

    let finalScore = 75;

    if (scoringProfile === 'legacy-passive') {
      let compScore = 85;
      if (hasDress || (types.includes('Top') && types.includes('Bottom'))) compScore += 5;
      if (hasShoes) compScore += 5;
      if (hasOuterwear) compScore += 5;

      let patterns = 0;
      for (const it of items) {
        const p = (it as any).pattern;
        if (p && p !== 'Solid' && p !== 'Plain') patterns++;
      }
      if (patterns > 1) compScore -= 15;

      let adjustedColorScore = colorMatch.score;
      const NEUTRALS = new Set(['black', 'white', 'charcoal', 'grey', 'gray', 'navy', 'beige', 'cream', 'brown', 'tan', 'camel', 'khaki']);
      const statement = items.find((i) => {
        const pat = (((i as any).pattern || (i as any).ai_attributes?.pattern) || '').toLowerCase();
        const desc = (i.description || (i as any).ai_attributes?.description || '').toLowerCase();
        const sub = (i.sub_category || '').toLowerCase();
        const tags = i.color_tags || [];
        return pat.includes('graphic') || pat.includes('floral') || pat.includes('plaid') || sub.includes('graphic') || desc.includes('graphic') || tags.length >= 3;
      });
      const hasNeutralOuter = items.some((i) => {
        if (resolveEffectiveGarmentBucket(i) !== 'Outerwear') return false;
        const name = (i.sub_category || i.category || '').toLowerCase();
        const isBlazer = name.includes('blazer') || name.includes('jacket') || name.includes('coat');
        const tags = (i.color_tags || []).map((c) => c.toLowerCase());
        return isBlazer && (tags.length === 0 || tags.some((c) => NEUTRALS.has(c)));
      });
      if (!!statement && hasNeutralOuter && (colorMatch.label === 'Clashing Colors' || adjustedColorScore < 75)) {
        adjustedColorScore = 86;
      }

      let occasionBonus = 0;
      if (intent.selectedOccasion) {
        const critique = evaluateWardrobeOutfit(
          items,
          undefined,
          { occasion: intent.selectedOccasion, additionalContext: intent.rawPrompt ?? undefined },
          profile
        );
        const severe = (critique.rawContradictions || []).some((c) => c.severity === 'severe');
        const major = (critique.rawContradictions || []).some((c) => c.severity === 'major');
        if (severe) occasionBonus -= 60;
        else if (major) occasionBonus -= 25;
        else if (critique.assessment === 'Appropriate for this occasion') occasionBonus += 15;
      }

      const w = profile?.preferenceWeights || { colorHarmony: 0.40, composition: 0.35, personalStyle: 0.25 };
      const avgNeglect = items.reduce((sum, i) => sum + neglect(i, config.neglectDays), 0) / items.length;
      const rawScore =
        adjustedColorScore * w.colorHarmony +
        compScore * w.composition +
        personal.score * w.personalStyle +
        occasionBonus +
        avgNeglect * 10;
      finalScore = Math.max(10, Math.min(100, Math.round(rawScore)));
    } else {
      let score = 40;
      score += Math.round(colorMatch.score * 0.3);
      score += Math.round(personal.score * 0.2);
      if (hasDress || (types.includes('Top') && types.includes('Bottom'))) score += 5;
      if (hasShoes) score += 5;
      if (hasOuterwear) score += 5;

      const preferredSet = new Set((intent.preferredColors || []).map((c) => c.toLowerCase()));
      if (preferredSet.size > 0 && colors.some((c) => preferredSet.has(c.toLowerCase()))) {
        score += 10;
      }

      const avgNeglect = items.reduce((sum, i) => sum + neglect(i, config.neglectDays), 0) / items.length;
      score += Math.round(avgNeglect * 8);

      let patterns = 0;
      for (const it of items) {
        const p = (it as any).pattern;
        if (p && p !== 'Solid' && p !== 'Plain') patterns++;
      }
      if (patterns > 1) score -= 15;

      finalScore = Math.min(100, Math.max(20, score));
    }

    return { score: finalScore, colorMatch, personal };
  };

  // Rank core candidates and retain Top K
  const scoredCores = survivingCorePool.map((combo) => ({
    combo,
    ...scoreCoreCombo(combo),
  }));
  scoredCores.sort((a, b) => b.score - a.score);
  const topCoreCandidates = scoredCores.slice(0, config.coreBaseLimit);

  // =========================================================================
  // STAGE 2: Bounded Canonical Ensemble Enrichment
  // =========================================================================
  // Extract accessory pools by subtype
  const allAccessories = filteredWardrobe.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory');

  const getAccessoryPool = (subtype: string): WardrobeItem[] => {
    return allAccessories
      .filter((i) => resolveAccessorySubtype(i) === subtype)
      .sort((a, b) => neglect(b, config.neglectDays) - neglect(a, config.neglectDays))
      .slice(0, config.accessoryCandidateLimit);
  };

  const bagPool = getAccessoryPool('bag');
  const beltPool = getAccessoryPool('belt');

  // Contextual pools: only active when environmental/prompt cues trigger them
  const isSunnyOrOutdoor =
    contextInterp.weather === 'hot' ||
    contextInterp.weather === 'warm' ||
    contextInterp.environment === 'outdoors' ||
    contextInterp.environment === 'beachResort' ||
    /\b(sun|sunglasses?|beach|park|walk)\b/i.test(intent.rawPrompt || '');
  const isColdOrWinter =
    contextInterp.temperatureRequirement === 'warmthNeeded' ||
    contextInterp.weather === 'cold' ||
    /\b(cold|winter|snow|chilly|freezing)\b/i.test(intent.rawPrompt || '');

  const eyewearPool = isSunnyOrOutdoor ? getAccessoryPool('eyewear') : [];
  const scarfPool = isColdOrWinter ? getAccessoryPool('scarf') : [];
  const headwearPool = isColdOrWinter || isSunnyOrOutdoor ? getAccessoryPool('headwear') : [];

  const candidates: CandidateOutfit[] = [];
  const seenKeys = new Set<string>();

  for (const { combo: coreCombo, score: coreScore, colorMatch: coreColorMatch } of topCoreCandidates) {
    // Generate bounded accessory bundles for this core
    let accessoryBundles: WardrobeItem[][] = [];

    if (mustUseAccessories.length > 0) {
      // Must-use accessories are strictly required in every bundle for this session
      accessoryBundles = [mustUseAccessories];
      // Optionally add a complementary bag or belt if not already locked
      if (!mustUseAccessories.some((a) => resolveAccessorySubtype(a) === 'bag') && bagPool.length > 0) {
        accessoryBundles.push([...mustUseAccessories, bagPool[0]]);
      }
      if (!mustUseAccessories.some((a) => resolveAccessorySubtype(a) === 'belt') && beltPool.length > 0) {
        accessoryBundles.push([...mustUseAccessories, beltPool[0]]);
      }
    } else {
      // Standard generative bundles:
      // Bundle 1: [None] — Clean look with 0 accessories (always evaluated!)
      accessoryBundles.push([]);

      // Bundle 2: [Bag]
      for (const bag of bagPool.slice(0, 2)) {
        accessoryBundles.push([bag]);
      }

      // Bundle 3: [Belt]
      for (const belt of beltPool.slice(0, 2)) {
        accessoryBundles.push([belt]);
      }

      // Bundle 4: [Bag + Belt]
      if (bagPool.length > 0 && beltPool.length > 0) {
        accessoryBundles.push([bagPool[0], beltPool[0]]);
      }

      // Bundle 5: Contextual accessory (eyewear / scarf / hat) if triggered
      if (eyewearPool.length > 0) {
        accessoryBundles.push([eyewearPool[0]]);
        if (bagPool.length > 0) accessoryBundles.push([bagPool[0], eyewearPool[0]]);
      }
      if (scarfPool.length > 0) {
        accessoryBundles.push([scarfPool[0]]);
      }
      if (headwearPool.length > 0) {
        accessoryBundles.push([headwearPool[0]]);
      }
    }

    // Cap bundles per core candidate
    const boundedBundles = accessoryBundles.slice(0, config.maxAccessoryBundlesPerCore);

    for (const accBundle of boundedBundles) {
      const fullItems = [...coreCombo, ...accBundle];
      const key = fullItems.map((i) => i.id).sort().join('|');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Verify contradictions for full ensemble
      const gProfiles = fullItems.map((item) => buildGarmentSemanticProfile(toCanvasShim(item), item));
      const structure = buildOutfitStructure(gProfiles);
      const contradictions = detectContradictions(gProfiles, reqs, structure);
      if (contradictions.some((c) => c.severity === 'severe')) {
        continue;
      }

      // Calculate bounded accessory score contribution
      let accessoryDelta = 0;
      if (accBundle.length > 0) {
        const fullColors = colorsOf(fullItems);
        const fullColorMatch = evaluateColors(fullColors);
        // Harmony bonus: bounded to at most +5
        if (fullColorMatch.score >= 85) {
          accessoryDelta += Math.min(5, Math.round((fullColorMatch.score - 80) * 0.25));
        } else if (fullColorMatch.score < 65) {
          // Clash penalty: bounded to at most -5
          accessoryDelta -= Math.min(5, Math.round((70 - fullColorMatch.score) * 0.25));
        }

        // Bound strictly to [-5, +5]
        accessoryDelta = Math.max(-5, Math.min(5, accessoryDelta));
      }

      const totalScore = Math.max(20, Math.min(100, coreScore + accessoryDelta));

      const types = fullItems.map((i) => resolveEffectiveGarmentBucket(i));
      const hasDress = types.includes('Dress');
      const hasShoes = types.includes('Shoes');
      const hasOuterwear = types.includes('Outerwear');
      const hasBag = fullItems.some((i) => resolveAccessorySubtype(i) === 'bag');
      const hasBelt = fullItems.some((i) => resolveAccessorySubtype(i) === 'belt');
      const accessoryCount = accBundle.length;

      const isComfortFocused = fullItems.some((i) => {
        const sub = (i.sub_category || '').toLowerCase();
        const desc = (i.description || '').toLowerCase();
        return sub.includes('sneaker') || sub.includes('flat') || desc.includes('relaxed') || desc.includes('stretch');
      });

      const isStatementFocused = fullItems.some((i) => {
        const p = ((i as any).pattern || '').toLowerCase();
        const tags = i.color_tags || [];
        return p.includes('graphic') || p.includes('floral') || tags.length >= 3;
      });

      candidates.push({
        candidateId: `cand_${candidates.length + 1}`,
        items: fullItems,
        key,
        baseScore: totalScore,
        colorMatchLabel: coreColorMatch.label,
        formalityLevel: intent.formality || 'casual',
        isComfortFocused,
        isStatementFocused,
        hasDress,
        hasShoes,
        hasOuterwear,
        hasBag,
        hasBelt,
        accessoryCount,
      });
    }
  }

  // Simplicity / Restraint Tie-Break:
  // When an accessorized candidate does not materially improve over a simpler look,
  // prefer the simpler ensemble (penalize extra optional accessories by 0.01 per item as a tie-breaker).
  candidates.sort((a, b) => {
    const aEffective = a.baseScore - (a.accessoryCount || 0) * 0.01;
    const bEffective = b.baseScore - (b.accessoryCount || 0) * 0.01;
    return bEffective - aEffective;
  });

  return candidates.slice(0, limit);
}
