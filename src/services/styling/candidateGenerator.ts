import { WardrobeItem, CandidateOutfit, StylingIntent } from '@/src/types/styleAdvisor';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';
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

const PER_SLOT_MAX = 8;
const NEGLECT_DAYS = 60;

function toCanvasShim(item: WardrobeItem) {
  return {
    wardrobe_item_id: item.id,
    garment_type: item.category || item.garment_type || '',
    name: item.sub_category || item.category || (item as any).name || 'Item',
    image_url: (item as any).photo_url || item.image_url || '',
    id: item.id,
  } as any;
}

function neglect(item: WardrobeItem): number {
  if (!item.wear_count) return 1;
  if (!item.last_worn_at) return 0.6;
  const days = (Date.now() - new Date(item.last_worn_at).getTime()) / 86_400_000;
  return Math.max(0, Math.min(1, days / NEGLECT_DAYS));
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
}

/**
 * Builds a bounded pool of verified, wardrobe-grounded candidate outfits satisfying user constraints.
 * Canonical implementation consolidated for both Style Advisor and passive discovery.
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

  // 4. Partition eligible items by slot
  const getSlotPool = (slotType: string): WardrobeItem[] => {
    const items = filteredWardrobe.filter((i) => resolveEffectiveGarmentBucket(i) === slotType);
    items.sort((a, b) => neglect(b) - neglect(a));

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
    return chosen.slice(0, PER_SLOT_MAX);
  };

  const tops = getSlotPool('Top');
  const bottoms = getSlotPool('Bottom');
  const dresses = getSlotPool('Dress');
  const shoes = getSlotPool('Shoes');
  const outerwear = getSlotPool('Outerwear');

  // 5. Form base combinations: Dress or Top + Bottom
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

  // 6. Assemble complete combinations
  const rawCombos: WardrobeItem[][] = [];
  for (const base of bases) {
    const withShoes = shoes.length > 0 ? shoes.map((s) => [...base, s]) : [base];
    for (const combo of withShoes) {
      rawCombos.push(combo);
      // Layering: add up to 2 outerwear options if available
      for (const o of outerwear.slice(0, 2)) {
        rawCombos.push([...combo, o]);
      }
    }
  }

  // 7. Enforce must-use items strictly
  let eligibleCombos = rawCombos;
  if (mustUseIds.length > 0) {
    eligibleCombos = rawCombos.filter((combo) => {
      const comboIds = new Set(combo.map((i) => i.id));
      return mustUseIds.every((mId) => comboIds.has(mId));
    });

    // If no combination naturally contained all must-use items, attempt synthetic injection
    if (eligibleCombos.length === 0 && mustUseItems.length > 0) {
      const syntheticCombos: WardrobeItem[][] = [];
      for (const base of bases) {
        let combo = [...base];
        for (const mItem of mustUseItems) {
          const mBucket = resolveEffectiveGarmentBucket(mItem);
          combo = combo.filter((i) => resolveEffectiveGarmentBucket(i) !== mBucket);
          combo.push(mItem);
        }
        if (shoes.length > 0 && !combo.some((i) => resolveEffectiveGarmentBucket(i) === 'Shoes')) {
          combo.push(shoes[0]);
        }
        syntheticCombos.push(combo);
      }
      eligibleCombos = syntheticCombos.filter((combo) => {
        const comboIds = new Set(combo.map((i) => i.id));
        return mustUseIds.every((mId) => comboIds.has(mId));
      });
    }
  }

  // If must-use requirement could not be satisfied, return empty (never violate must-use)
  if (mustUseIds.length > 0 && eligibleCombos.length === 0) {
    return [];
  }

  // 8. Filter out severe contradictions across full ensemble
  const validCombos = eligibleCombos.filter((combo) => {
    const garmentProfiles = combo.map((item) => buildGarmentSemanticProfile(toCanvasShim(item), item));
    const structure = buildOutfitStructure(garmentProfiles);
    const contradictions = detectContradictions(garmentProfiles, reqs, structure);
    return !contradictions.some((c) => c.severity === 'severe');
  });

  const finalPool = validCombos.length > 0 ? validCombos : eligibleCombos;

  // 9. Score and transform to CandidateOutfit objects
  const seenKeys = new Set<string>();
  const candidates: CandidateOutfit[] = [];

  for (const items of finalPool) {
    const key = items.map((i) => i.id).sort().join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const colors = colorsOf(items);
    const colorMatch = evaluateColors(colors);
    const personal = computePersonalAffinity(items, profile, intent.selectedOccasion);

    const types = items.map((i) => resolveEffectiveGarmentBucket(i));
    const hasDress = types.includes('Dress');
    const hasShoes = types.includes('Shoes');
    const hasOuterwear = types.includes('Outerwear');

    let finalScore = 75;

    if (scoringProfile === 'legacy-passive') {
      // Legacy 40/35/25 weighting with statement anchoring and occasion adjustments
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
      const avgNeglect = items.reduce((sum, i) => sum + neglect(i), 0) / items.length;
      const rawScore =
        adjustedColorScore * w.colorHarmony +
        compScore * w.composition +
        personal.score * w.personalStyle +
        occasionBonus +
        avgNeglect * 10;
      finalScore = Math.max(10, Math.min(100, Math.round(rawScore)));
    } else {
      // Intent-driven additive scoring formula (calibrated to preserve neglect bonuses and clash penalties)
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

      const avgNeglect = items.reduce((sum, i) => sum + neglect(i), 0) / items.length;
      score += Math.round(avgNeglect * 8);

      let patterns = 0;
      for (const it of items) {
        const p = (it as any).pattern;
        if (p && p !== 'Solid' && p !== 'Plain') patterns++;
      }
      if (patterns > 1) score -= 15;

      finalScore = Math.min(100, Math.max(20, score));
    }

    const isComfortFocused = items.some((i) => {
      const sub = (i.sub_category || '').toLowerCase();
      const desc = (i.description || '').toLowerCase();
      return sub.includes('sneaker') || sub.includes('flat') || desc.includes('relaxed') || desc.includes('stretch');
    });

    const isStatementFocused = items.some((i) => {
      const p = ((i as any).pattern || '').toLowerCase();
      const tags = i.color_tags || [];
      return p.includes('graphic') || p.includes('floral') || tags.length >= 3;
    });

    candidates.push({
      candidateId: `cand_${candidates.length + 1}`,
      items,
      key,
      baseScore: finalScore,
      colorMatchLabel: colorMatch.label,
      formalityLevel: intent.formality || 'casual',
      isComfortFocused,
      isStatementFocused,
      hasDress,
      hasShoes,
      hasOuterwear,
    });
  }

  candidates.sort((a, b) => b.baseScore - a.baseScore);
  return candidates.slice(0, limit);
}
