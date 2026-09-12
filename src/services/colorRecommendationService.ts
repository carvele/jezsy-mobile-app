import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { evaluateColors, undertoneAffinity, Undertone } from '@/src/utils/colorMatcher';

export type InventoryVariant = Database['public']['Tables']['inventory']['Row'];

export type ColorRecommendation = {
  colorKey: string; // canonical group key: color.trim().toLowerCase(), '' for a colorless product
  colorName: string; // merchant display name ('Standard' when colorless)
  hexColor: string | null;
  score: number; // 0-100 heuristic score
  matchTier: 'Best Match' | 'Great Match' | 'Good Match' | 'Neutral';
  wardrobePairingsCount: number;
  sellableVariants: InventoryVariant[];
};

export type PersonalizationMode = 'personalized' | 'partial' | 'generic';

export type ColorRecommendationResult = {
  recommendations: ColorRecommendation[];
  personalizationMode: PersonalizationMode;
};

type ColorProfile = {
  undertone: Undertone;
  preferredColors: string[];
  avoidedColors: string[];
};

const DEFAULT_PROFILE: ColorProfile = { undertone: 'unknown', preferredColors: [], avoidedColors: [] };

// Heuristic score deltas, not colorimetric fact -- reasonable starting weights
// until real usage data exists (see undertoneAffinity's own doc comment for
// the same caveat on the underlying hue judgment).
const VISUAL_DELTA = 15; // per +1/-1 step from undertoneAffinity
const PREFERRED_BONUS = 25;
const AVOIDED_PENALTY = 30; // applied unconditionally, not renormalized -- an explicit "avoid" should always suppress a color
const WARDROBE_BASELINE = 70; // evaluateColors' own "Neutral / Balanced" band center
const WARDROBE_SCALE = 0.4;
const OCCASION_DELTA = 8;

// Minimal, explicit occasion heuristic: formal-leaning occasions favor
// neutrals, going-out occasions favor saturated colors. A placeholder
// starting rule, not a fashion-styling database -- unmatched occasions are
// simply neutral (delta 0), never penalized.
const FORMAL_OCCASIONS = new Set(['formal', 'business', 'wedding', 'interview']);
const BOLD_OCCASIONS = new Set(['party', 'night out', 'date night', 'festival']);

function occasionDelta(occasion: string | undefined, isNeutralColor: boolean): number {
  if (!occasion) return 0;
  const key = occasion.trim().toLowerCase();
  if (FORMAL_OCCASIONS.has(key)) return isNeutralColor ? OCCASION_DELTA : -OCCASION_DELTA / 2;
  if (BOLD_OCCASIONS.has(key)) return isNeutralColor ? -OCCASION_DELTA / 2 : OCCASION_DELTA;
  return 0;
}

function matchTier(score: number): ColorRecommendation['matchTier'] {
  if (score >= 75) return 'Best Match';
  if (score >= 60) return 'Great Match';
  if (score >= 50) return 'Good Match';
  return 'Neutral';
}

async function fetchColorProfile(userId: string): Promise<ColorProfile> {
  const { data } = await supabase
    .from('user_color_profiles')
    .select('undertone, preferred_colors, avoided_colors')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return DEFAULT_PROFILE;
  return {
    undertone: (data.undertone as Undertone) ?? 'unknown',
    preferredColors: (data.preferred_colors ?? []).map((c) => c.trim().toLowerCase()),
    avoidedColors: (data.avoided_colors ?? []).map((c) => c.trim().toLowerCase()),
  };
}

async function fetchWardrobeColorTags(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('wardrobe_items')
    .select('color_tags')
    .eq('user_id', userId)
    .eq('deleted', false);
  return (data ?? []).flatMap((row) => row.color_tags ?? []).filter(Boolean) as string[];
}

type GroupedColor = {
  colorKey: string;
  colorName: string;
  hexColor: string | null;
  variants: InventoryVariant[];
};

function groupByColor(variants: InventoryVariant[]): GroupedColor[] {
  const groups = new Map<string, GroupedColor>();
  for (const v of variants) {
    const colorKey = (v.color ?? '').trim().toLowerCase();
    const existing = groups.get(colorKey);
    if (existing) {
      existing.variants.push(v);
      if (!existing.hexColor && v.hex_color) existing.hexColor = v.hex_color;
    } else {
      groups.set(colorKey, {
        colorKey,
        colorName: (v.color ?? '').trim() || 'Standard',
        hexColor: v.hex_color ?? null,
        variants: [v],
      });
    }
  }
  return Array.from(groups.values());
}

/**
 * Ranks a product's actual commercial colors by how likely they are to
 * complement this user, combining visual (undertone), stated preference,
 * wardrobe compatibility, and occasion signals. Signals with no data behind
 * them (no color profile, empty wardrobe, no occasion given) simply don't
 * contribute -- see personalizationMode for whether enough signal existed to
 * call this "personalized" at all.
 */
export async function getRecommendedColors(
  userId: string | null | undefined,
  productId: string,
  context?: { occasion?: string }
): Promise<ColorRecommendationResult> {
  const [{ data: inventory }, profile, wardrobeColorTags] = await Promise.all([
    supabase.from('inventory').select('*').eq('product_doc_id', productId).eq('deleted', false),
    userId ? fetchColorProfile(userId) : Promise.resolve(DEFAULT_PROFILE),
    userId ? fetchWardrobeColorTags(userId) : Promise.resolve<string[]>([]),
  ]);

  const grouped = groupByColor(inventory ?? []);

  const hasVisual = profile.undertone !== 'unknown';
  const hasPref = profile.preferredColors.length > 0;
  const hasWardrobe = wardrobeColorTags.length > 0;
  const hasOccasion = !!context?.occasion;
  const signalCount = [hasVisual, hasPref, hasWardrobe, hasOccasion].filter(Boolean).length;
  const personalizationMode: PersonalizationMode =
    signalCount === 0 ? 'generic' : signalCount >= 2 ? 'personalized' : 'partial';

  const recommendations: ColorRecommendation[] = grouped.map((group) => {
    const colorRef = group.hexColor || group.colorName;
    const wardrobePairingsCount = group.colorKey
      ? wardrobeColorTags.filter((tag) => tag.trim().toLowerCase() === group.colorKey).length
      : 0;

    let weightedDelta = 0;
    if (signalCount > 0) {
      let deltaSum = 0;
      if (hasVisual) deltaSum += undertoneAffinity(colorRef, profile.undertone) * VISUAL_DELTA;
      if (hasPref) {
        deltaSum += profile.preferredColors.includes(group.colorKey) ? PREFERRED_BONUS : 0;
      }
      if (hasWardrobe) {
        const harmony = evaluateColors([colorRef, ...wardrobeColorTags]).score;
        deltaSum += (harmony - WARDROBE_BASELINE) * WARDROBE_SCALE;
      }
      if (hasOccasion) {
        const isNeutralColor = undertoneAffinity(colorRef, 'warm') === 0 && undertoneAffinity(colorRef, 'cool') === 0;
        deltaSum += occasionDelta(context?.occasion, isNeutralColor);
      }
      weightedDelta = deltaSum / signalCount;
    }

    // An explicit "avoid this color" always suppresses it, independent of
    // renormalization -- a stated dislike should never be diluted away by
    // other signals averaging it back up.
    const avoidedPenalty = profile.avoidedColors.includes(group.colorKey) ? AVOIDED_PENALTY : 0;

    const score = Math.max(0, Math.min(100, Math.round(50 + weightedDelta - avoidedPenalty)));
    const sellableVariants = group.variants.filter((v) => (v.available ?? 0) > 0 && !v.deleted);

    return {
      colorKey: group.colorKey,
      colorName: group.colorName,
      hexColor: group.hexColor,
      score,
      matchTier: matchTier(score),
      wardrobePairingsCount,
      sellableVariants,
    };
  });

  recommendations.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Deterministic tie-breaker: generic fallbacks must not depend on DB arrival order.
    return a.colorKey.localeCompare(b.colorKey);
  });

  return { recommendations, personalizationMode };
}

export const colorRecommendationService = { getRecommendedColors };
