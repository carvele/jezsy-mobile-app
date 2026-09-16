/**
 * Builds outfit suggestions from the user's own wardrobe.
 *
 * Deterministic and local: it enumerates valid garment combinations, scores
 * each on colour harmony, personal preference affinity, occasion fit, and neglect bonus.
 */

import { Database } from '@/src/types/database.types';
import { evaluateColors, ColorMatchResult } from './colorMatcher';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { computePersonalAffinity } from './personalStyleEngine';
import { explainOutfit, OutfitExplanation } from './outfitExplainer';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export interface GeneratedOutfit {
  key: string;
  items: WardrobeItem[];
  score: number;
  label: ColorMatchResult['label'];
  reason: string;
  explanation?: OutfitExplanation;
  personalScore?: number;
  occasion?: string | null;
}

export interface GenerateOutfitsOptions {
  limit?: number;
  occasion?: string | null;
  profile?: UserStyleProfileDto | null;
  requiredItemId?: string | null; // When styling a specific item
}

const PER_SLOT = 8;
const NEGLECT_DAYS = 60;

function bySlot(items: WardrobeItem[], type: string): WardrobeItem[] {
  return items
    .filter((i) => i.garment_type === type)
    .sort((a, b) => neglect(b) - neglect(a))
    .slice(0, PER_SLOT);
}

// 0..1, higher means the item has been ignored longer.
function neglect(item: WardrobeItem): number {
  if (!item.wear_count) return 1;
  if (!item.last_worn_at) return 0.6;
  const days = (Date.now() - new Date(item.last_worn_at).getTime()) / 86_400_000;
  return Math.max(0, Math.min(1, days / NEGLECT_DAYS));
}

function colorsOf(items: WardrobeItem[]): string[] {
  return items.flatMap((i) => i.color_tags || []);
}

function build(
  items: WardrobeItem[],
  options?: GenerateOutfitsOptions
): GeneratedOutfit {
  const match = evaluateColors(colorsOf(items));
  const avgNeglect = items.reduce((sum, i) => sum + neglect(i), 0) / items.length;
  const neverWorn = items.filter((i) => !i.wear_count);

  const personal = computePersonalAffinity(items, options?.profile, options?.occasion);

  // 1. Composition Score
  let compScore = 85;
  const types = items.map((i) => i.garment_type);
  const hasDress = types.includes('Dress');
  const hasShoes = types.includes('Shoes');
  const hasOuter = types.includes('Outerwear');

  if (hasDress || (types.includes('Top') && types.includes('Bottom'))) {
    compScore += 5;
  }
  if (hasShoes) compScore += 5;
  if (hasOuter) compScore += 5;

  // 2. Pattern Clash Guard
  let patternedCount = 0;
  for (const item of items) {
    const pattern = (item as any).pattern;
    if (pattern && pattern !== 'Solid' && pattern !== 'Plain') {
      patternedCount++;
    }
  }
  if (patternedCount > 1) {
    compScore -= 15; // penalize clashing loud patterns
  }

  // 3. Occasion Suitability
  let occasionBonus = 0;
  if (options?.occasion) {
    const target = options.occasion.toLowerCase();
    for (const item of items) {
      const occs: string[] = (item as any).occasions || [];
      if (occs.some((o) => o.toLowerCase().includes(target) || target.includes(o.toLowerCase()))) {
        occasionBonus += 6;
      }
    }
    occasionBonus = Math.min(15, occasionBonus);
  }

  // 4. Weight Calculation
  const w = options?.profile?.preferenceWeights || {
    colorHarmony: 0.40,
    composition: 0.35,
    personalStyle: 0.25,
  };

  const rawScore =
    match.score * w.colorHarmony +
    compScore * w.composition +
    personal.score * w.personalStyle +
    occasionBonus +
    avgNeglect * 10;

  const finalScore = Math.max(10, Math.min(100, Math.round(rawScore)));

  // 5. Stylist Explanation
  const explanation = explainOutfit(items, match, personal, options?.occasion);

  let reason = explanation.summary;
  if (neverWorn.length === 1) {
    reason += ` Includes a piece you have never worn.`;
  } else if (neverWorn.length > 1) {
    reason += ` Puts ${neverWorn.length} never-worn pieces to work.`;
  }

  return {
    key: items.map((i) => i.id).sort().join('|'),
    items,
    score: finalScore,
    label: match.label,
    reason,
    explanation,
    personalScore: personal.score,
    occasion: options?.occasion,
  };
}

/**
 * Returns ranked outfit suggestions, best first.
 * Supports backward-compatible call: generateOutfits(items, 6)
 * As well as options object: generateOutfits(items, { limit: 6, occasion: 'Work', profile })
 */
export function generateOutfits(
  items: WardrobeItem[],
  optionsOrLimit: number | GenerateOutfitsOptions = 6
): GeneratedOutfit[] {
  const options: GenerateOutfitsOptions =
    typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : optionsOrLimit;

  const limit = options.limit || 6;

  // If a specific required item was requested (e.g. "Style this item"), filter pools
  let eligibleItems = items;
  if (options.requiredItemId) {
    const targetItem = items.find((i) => i.id === options.requiredItemId);
    if (targetItem) {
      eligibleItems = items.filter(
        (i) => i.id === options.requiredItemId || i.garment_type !== targetItem.garment_type
      );
    }
  }

  const tops = bySlot(eligibleItems, 'Top');
  const bottoms = bySlot(eligibleItems, 'Bottom');
  const dresses = bySlot(eligibleItems, 'Dress');
  const shoes = bySlot(eligibleItems, 'Shoes');
  const outerwear = bySlot(eligibleItems, 'Outerwear');

  const bases: WardrobeItem[][] = [];
  for (const d of dresses) bases.push([d]);
  for (const t of tops) for (const b of bottoms) bases.push([t, b]);

  if (bases.length === 0) return [];

  const candidates: GeneratedOutfit[] = [];
  for (const base of bases) {
    // If requiredItemId specified, verify it's in this base or layer
    const withShoes = shoes.length ? shoes.map((s) => [...base, s]) : [base];
    for (const combo of withShoes) {
      if (!options.requiredItemId || combo.some((i) => i.id === options.requiredItemId)) {
        candidates.push(build(combo, options));
      }
      for (const o of outerwear.slice(0, 2)) {
        const layered = [...combo, o];
        if (!options.requiredItemId || layered.some((i) => i.id === options.requiredItemId)) {
          candidates.push(build(layered, options));
        }
      }
    }
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((o) => {
      if (seen.has(o.key)) return false;
      seen.add(o.key);
      return true;
    })
    .slice(0, limit);
}

export interface WardrobeStats {
  total: number;
  neverWorn: number;
  neglected: number;
  mostWorn: WardrobeItem | null;
  totalWears: number;
}

/** Aggregates the wear data the app already records. */
export function computeStats(items: WardrobeItem[]): WardrobeStats {
  const neverWorn = items.filter((i) => !i.wear_count).length;
  const neglected = items.filter((i) => i.wear_count > 0 && neglect(i) >= 1).length;
  const mostWorn = items.reduce<WardrobeItem | null>(
    (best, i) => (!best || i.wear_count > best.wear_count ? i : best),
    null
  );
  const totalWears = items.reduce((sum, i) => sum + (i.wear_count || 0), 0);

  return {
    total: items.length,
    neverWorn,
    neglected,
    mostWorn,
    totalWears,
  };
}
