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
} from '@/src/utils/aiStylistAdvisor';

const PER_SLOT_MAX = 8;
const NEGLECT_DAYS = 60;

function toCanvasShim(item: WardrobeItem) {
  return {
    wardrobe_item_id: item.id,
    garment_type: item.category || '',
    name: item.sub_category || item.category || 'Item',
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

export interface CandidateGenerationOptions {
  limit?: number;
  profile?: UserStyleProfileDto | null;
}

/**
 * Builds a bounded pool of verified, wardrobe-grounded candidate outfits satisfying user constraints.
 */
export function generateCandidateOutfits(
  wardrobe: WardrobeItem[],
  intent: StylingIntent,
  options?: CandidateGenerationOptions
): CandidateOutfit[] {
  if (!wardrobe || wardrobe.length === 0) return [];

  const limit = options?.limit || 10;
  const profile = options?.profile || null;

  // 1. Apply hard exclusions (excluded items & avoided colors)
  const excludedSet = new Set(intent.excludedItemIds || []);
  const avoidedColorSet = new Set((intent.avoidedColors || []).map((c) => c.toLowerCase()));

  const filteredWardrobe = wardrobe.filter((item) => {
    if (excludedSet.has(item.id)) return false;
    // If avoided color is specified, filter item if its colors match avoided colors
    if (avoidedColorSet.size > 0 && item.color_tags && item.color_tags.length > 0) {
      const itemColors = item.color_tags.map((c) => c.toLowerCase());
      const hasAvoided = itemColors.some((c) => avoidedColorSet.has(c));
      // Only filter if there are other pieces in this bucket so we don't starve sparse wardrobes
      if (hasAvoided) {
        const bucket = resolveEffectiveGarmentBucket(item);
        const alternativesInBucket = wardrobe.filter(
          (w) =>
            w.id !== item.id &&
            !excludedSet.has(w.id) &&
            resolveEffectiveGarmentBucket(w) === bucket &&
            !(w.color_tags || []).some((c) => avoidedColorSet.has(c.toLowerCase()))
        );
        if (alternativesInBucket.length > 0) {
          return false;
        }
      }
    }
    return true;
  });

  // 2. Prepare occasion requirements for contradiction filtering
  const contextInterp = interpretOutfitContext({
    occasion: intent.selectedOccasion || intent.rawPrompt || 'Casual',
    additionalContext: intent.rawPrompt,
  });
  const reqs = buildOccasionRequirements(contextInterp);

  // 3. Partition eligible items by slot
  const getSlotPool = (slotType: string): WardrobeItem[] => {
    const items = filteredWardrobe.filter((i) => resolveEffectiveGarmentBucket(i) === slotType);
    // Sort neglect first
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

  // 4. Must-use item enforcement
  const mustUseIds = intent.mustUseItemIds || [];
  const mustUseItems = wardrobe.filter((i) => mustUseIds.includes(i.id));

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

  // 7. Enforce must-use items
  let eligibleCombos = rawCombos;
  if (mustUseIds.length > 0) {
    eligibleCombos = rawCombos.filter((combo) => {
      const comboIds = new Set(combo.map((i) => i.id));
      return mustUseIds.every((mId) => comboIds.has(mId));
    });

    // If no combination naturally contained all must-use items (e.g. must-use blazer was outer),
    // inject the must-use pieces into compatible bases
    if (eligibleCombos.length === 0 && mustUseItems.length > 0) {
      const syntheticCombos: WardrobeItem[][] = [];
      for (const base of bases) {
        let combo = [...base];
        for (const mItem of mustUseItems) {
          const mBucket = resolveEffectiveGarmentBucket(mItem);
          // Replace matching slot in base or add outer/shoes
          combo = combo.filter((i) => resolveEffectiveGarmentBucket(i) !== mBucket);
          combo.push(mItem);
        }
        if (shoes.length > 0 && !combo.some((i) => resolveEffectiveGarmentBucket(i) === 'Shoes')) {
          combo.push(shoes[0]);
        }
        syntheticCombos.push(combo);
      }
      eligibleCombos = syntheticCombos;
    }
  }

  // 8. Filter out severe contradictions across full outfit
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

    // Base score calculation
    let score = 75;
    score += Math.round(colorMatch.score * 0.3);
    score += Math.round(personal.score * 0.2);
    if (hasDress || (types.includes('Top') && types.includes('Bottom'))) score += 5;
    if (hasShoes) score += 5;
    if (hasOuterwear) score += 5;

    // Preferred colors bonus
    const preferredSet = new Set((intent.preferredColors || []).map((c) => c.toLowerCase()));
    if (preferredSet.size > 0 && colors.some((c) => preferredSet.has(c.toLowerCase()))) {
      score += 10;
    }

    // Neglect discovery bonus
    const avgNeglect = items.reduce((sum, i) => sum + neglect(i), 0) / items.length;
    score += Math.round(avgNeglect * 8);

    // Pattern clash penalty
    let patterns = 0;
    for (const it of items) {
      const p = (it as any).pattern;
      if (p && p !== 'Solid' && p !== 'Plain') patterns++;
    }
    if (patterns > 1) score -= 15;

    // Detect styling characteristics
    const isComfortFocused =
      items.some((i) => {
        const sub = (i.sub_category || '').toLowerCase();
        const desc = (i.description || '').toLowerCase();
        return sub.includes('sneaker') || sub.includes('flat') || desc.includes('relaxed') || desc.includes('stretch');
      });

    const isStatementFocused =
      items.some((i) => {
        const p = ((i as any).pattern || '').toLowerCase();
        const tags = i.color_tags || [];
        return p.includes('graphic') || p.includes('floral') || tags.length >= 3;
      });

    candidates.push({
      candidateId: `cand_${candidates.length + 1}`,
      items,
      key,
      baseScore: Math.min(100, Math.max(20, score)),
      colorMatchLabel: colorMatch.label,
      formalityLevel: intent.formality || 'casual',
      isComfortFocused,
      isStatementFocused,
      hasDress,
      hasShoes,
      hasOuterwear,
    });
  }

  // Sort best baseScore first and return top limit
  candidates.sort((a, b) => b.baseScore - a.baseScore);
  return candidates.slice(0, limit);
}
