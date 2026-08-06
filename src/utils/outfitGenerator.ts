/**
 * Builds outfit suggestions from the user's own wardrobe.
 *
 * Deterministic and local: it enumerates valid garment combinations, scores
 * each on colour harmony plus how neglected its pieces are, and explains the
 * result. Nothing is sent anywhere. The neglect weighting is the point -- a
 * suggestion engine that keeps proposing the same three favourite items is
 * not worth opening, so pieces the user has not reached for score higher.
 */

import { Database } from '@/src/types/database.types';
import { evaluateColors, ColorMatchResult } from './colorMatcher';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export interface GeneratedOutfit {
  key: string;
  items: WardrobeItem[];
  score: number;
  label: ColorMatchResult['label'];
  reason: string;
}

// Per-slot candidate cap. Enumerating every combination is factorial; a
// wardrobe of 60 tops and 60 bottoms is 3600 pairs before shoes. Taking the
// most-neglected few per slot keeps this linear enough to run on render.
const PER_SLOT = 6;
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

function build(items: WardrobeItem[]): GeneratedOutfit {
  const match = evaluateColors(colorsOf(items));
  const avgNeglect = items.reduce((sum, i) => sum + neglect(i), 0) / items.length;
  const neverWorn = items.filter((i) => !i.wear_count);

  // Harmony leads; neglect nudges. A great-looking outfit of favourites still
  // outranks a mediocre one of forgotten pieces.
  const score = Math.round(match.score * 0.8 + avgNeglect * 100 * 0.2);

  let reason = match.feedback;
  if (neverWorn.length === 1) {
    reason += ` Includes a piece you have never worn.`;
  } else if (neverWorn.length > 1) {
    reason += ` Puts ${neverWorn.length} never-worn pieces to work.`;
  }

  return {
    key: items.map((i) => i.id).sort().join('|'),
    items,
    score: Math.max(0, Math.min(100, score)),
    label: match.label,
    reason,
  };
}

/**
 * Returns ranked outfit suggestions, best first. An outfit is a dress or a
 * top-and-bottom, always with shoes when the user owns any, optionally layered
 * with outerwear.
 */
export function generateOutfits(items: WardrobeItem[], limit = 6): GeneratedOutfit[] {
  const tops = bySlot(items, 'Top');
  const bottoms = bySlot(items, 'Bottom');
  const dresses = bySlot(items, 'Dress');
  const shoes = bySlot(items, 'Shoes');
  const outerwear = bySlot(items, 'Outerwear');

  const bases: WardrobeItem[][] = [];
  for (const d of dresses) bases.push([d]);
  for (const t of tops) for (const b of bottoms) bases.push([t, b]);

  if (bases.length === 0) return [];

  const candidates: GeneratedOutfit[] = [];
  for (const base of bases) {
    // Shoes complete an outfit, but a wardrobe without any should still get
    // suggestions rather than an empty screen.
    const withShoes = shoes.length ? shoes.map((s) => [...base, s]) : [base];
    for (const combo of withShoes) {
      candidates.push(build(combo));
      // Layering is offered as a separate suggestion rather than always-on, so
      // the user sees both the plain and the layered version of a good base.
      for (const o of outerwear.slice(0, 2)) candidates.push(build([...combo, o]));
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

/** Aggregates the wear data the app already records but never surfaced. */
export function computeStats(items: WardrobeItem[]): WardrobeStats {
  const neverWorn = items.filter((i) => !i.wear_count).length;
  const neglected = items.filter((i) => i.wear_count > 0 && neglect(i) >= 1).length;
  const mostWorn = items.reduce<WardrobeItem | null>(
    (best, i) => (!best || i.wear_count > best.wear_count ? i : best),
    null,
  );

  return {
    total: items.length,
    neverWorn,
    neglected,
    mostWorn: mostWorn && mostWorn.wear_count > 0 ? mostWorn : null,
    totalWears: items.reduce((sum, i) => sum + (i.wear_count || 0), 0),
  };
}
