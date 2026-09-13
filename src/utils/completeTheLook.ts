/**
 * completeTheLook.ts
 * AI Stylist recommendation engine for matching current viewed product
 * with complementary catalog items into realistic, slot-deduped outfits.
 *
 * Implements a 2D fashion taxonomy (ClothingSlot + OccasionArchetype),
 * outfit blueprint architecture, strict zero-tolerance occasion compatibility,
 * and multi-factor normalized scoring.
 */

import { evaluateColors, ColorMatchResult } from './colorMatcher';

export type ClothingSlot =
  | 'top'
  | 'bottom'
  | 'one_piece'
  | 'outerwear'
  | 'footwear'
  | 'bag'
  | 'accessory'
  | 'intimates';

export type OccasionArchetype =
  | 'active'
  | 'formal'
  | 'tailored'
  | 'casual'
  | 'streetwear'
  | 'unknown';

export interface CatalogItem {
  id: string;
  name: string;
  category?: string | null;
  category_id?: string | null;
  color?: string | null;
  price: number;
  sale_price?: number | null;
  on_sale?: boolean | null;
  image_url: string;
  style_slot?: ClothingSlot | null;
  occasion_tags?: OccasionArchetype[] | null;
}

export interface BlueprintRequirement {
  slot: ClothingSlot;
  required: boolean;
  priority: number;
  max: 1;
}

export interface LookRecommendation {
  product: CatalogItem;
  slot: ClothingSlot;
  harmony: ColorMatchResult;
  score: number;
  reason: string;
}

export const MIN_SLOT_SCORE = 45;

/**
 * Occasion Compatibility Matrix (0.0 to 1.0)
 * 0.0 is a hard exclusion gate.
 */
export const OCCASION_COMPATIBILITY: Record<OccasionArchetype, Record<OccasionArchetype, number>> = {
  active: {
    active: 1.0,
    casual: 0.40,
    streetwear: 0.55,
    tailored: 0.0, // Hard zero exclusion
    formal: 0.0,   // Hard zero exclusion
    unknown: 0.40,
  },
  formal: {
    formal: 1.0,
    tailored: 0.70,
    casual: 0.20,
    streetwear: 0.0, // Hard zero exclusion
    active: 0.0,     // Hard zero exclusion
    unknown: 0.40,
  },
  tailored: {
    tailored: 1.0,
    formal: 0.70,
    casual: 0.65,
    streetwear: 0.35,
    active: 0.0,     // Hard zero exclusion
    unknown: 0.40,
  },
  casual: {
    casual: 1.0,
    streetwear: 0.80,
    tailored: 0.65,
    active: 0.40,
    formal: 0.20,
    unknown: 0.40,
  },
  streetwear: {
    streetwear: 1.0,
    casual: 0.80,
    active: 0.55,
    tailored: 0.35,
    formal: 0.0,     // Hard zero exclusion
    unknown: 0.40,
  },
  unknown: {
    active: 0.40,
    formal: 0.40,
    tailored: 0.40,
    casual: 0.40,
    streetwear: 0.40,
    unknown: 0.40,
  },
};

/**
 * Outfit Blueprints defining complementary slots for each anchor clothing slot.
 */
export const OUTFIT_BLUEPRINTS: Record<ClothingSlot, BlueprintRequirement[]> = {
  top: [
    { slot: 'bottom', required: true, priority: 1, max: 1 },
    { slot: 'footwear', required: false, priority: 2, max: 1 },
    { slot: 'outerwear', required: false, priority: 3, max: 1 },
    { slot: 'bag', required: false, priority: 4, max: 1 },
    { slot: 'accessory', required: false, priority: 5, max: 1 },
  ],
  bottom: [
    { slot: 'top', required: true, priority: 1, max: 1 },
    { slot: 'footwear', required: false, priority: 2, max: 1 },
    { slot: 'outerwear', required: false, priority: 3, max: 1 },
    { slot: 'bag', required: false, priority: 4, max: 1 },
    { slot: 'accessory', required: false, priority: 5, max: 1 },
  ],
  one_piece: [
    { slot: 'footwear', required: false, priority: 1, max: 1 },
    { slot: 'bag', required: false, priority: 2, max: 1 },
    { slot: 'outerwear', required: false, priority: 3, max: 1 },
    { slot: 'accessory', required: false, priority: 4, max: 1 },
  ],
  outerwear: [
    { slot: 'top', required: true, priority: 1, max: 1 },
    { slot: 'bottom', required: true, priority: 2, max: 1 },
    { slot: 'footwear', required: false, priority: 3, max: 1 },
    { slot: 'bag', required: false, priority: 4, max: 1 },
  ],
  footwear: [
    { slot: 'top', required: true, priority: 1, max: 1 },
    { slot: 'bottom', required: true, priority: 2, max: 1 },
    { slot: 'outerwear', required: false, priority: 3, max: 1 },
    { slot: 'bag', required: false, priority: 4, max: 1 },
  ],
  bag: [
    { slot: 'top', required: false, priority: 1, max: 1 },
    { slot: 'bottom', required: false, priority: 2, max: 1 },
    { slot: 'outerwear', required: false, priority: 3, max: 1 },
    { slot: 'footwear', required: false, priority: 4, max: 1 },
  ],
  accessory: [
    { slot: 'one_piece', required: false, priority: 1, max: 1 },
    { slot: 'top', required: false, priority: 2, max: 1 },
    { slot: 'bottom', required: false, priority: 3, max: 1 },
    { slot: 'outerwear', required: false, priority: 4, max: 1 },
    { slot: 'footwear', required: false, priority: 5, max: 1 },
  ],
  intimates: [],
};

/**
 * 5-Step Precedence Classifier:
 * 1. Explicit normalized metadata (item.style_slot)
 * 2. Category mapping
 * 3. Product slug
 * 4. Product name keyword heuristics
 * 5. Fallback
 */
export function classifyClothingSlot(item: CatalogItem): ClothingSlot {
  if (item.style_slot) return item.style_slot;

  const text = `${item.category || ''} ${item.name || ''}`.toLowerCase();

  // 1. Intimates guard (always check first to prevent accidental classification)
  if (/\b(underwear|lingerie|bra|panties|panty|thong|shapewear|briefs|boxers|bralette)\b/.test(text)) {
    return 'intimates';
  }

  // 2. One-piece (dresses, jumpsuits, rompers, gowns)
  if (/\b(dress|gown|jumpsuit|romper|overall|slip dress|maxi dress|midi dress|mini dress)\b/.test(text)) {
    return 'one_piece';
  }

  // 3. Outerwear (blazers, coats, jackets)
  if (/\b(blazer|coat|jacket|trench|cardigan|parka|outerwear|vest|bomber|windbreaker|overcoat)\b/.test(text)) {
    return 'outerwear';
  }

  // 4. Footwear (shoes, heels, sneakers, boots, sandals)
  if (/\b(shoes|footwear|heels|pumps|stiletto|flats|boots|booties|loafers|sandals|mules|sneakers|runners|slides)\b/.test(text)) {
    return 'footwear';
  }

  // 5. Bags
  if (/\b(bag|handbag|clutch|tote|crossbody|shoulder bag|purse|backpack|duffel|satchel)\b/.test(text)) {
    return 'bag';
  }

  // 6. Accessories & Jewelry
  if (/\b(accessory|accessories|jewelry|necklace|earrings|bracelet|ring|belt|scarf|sunglasses|hat|watch)\b/.test(text)) {
    return 'accessory';
  }

  // 7. Bottoms
  if (/\b(skirt|mini skirt|midi skirt|maxi skirt|pants|trousers|jeans|shorts|slacks|leggings|biker shorts|sweatpants|joggers|bottoms|bottom)\b/.test(text)) {
    return 'bottom';
  }

  // 8. Tops
  if (/\b(top|blouse|shirt|t-shirt|tee|crop top|tank|camisole|knitwear|sweater|pullover|hoodie|sweatshirt|polo)\b/.test(text)) {
    return 'top';
  }

  // Category fallback
  const cat = (item.category || '').toLowerCase();
  if (cat.includes('bottom')) return 'bottom';
  if (cat.includes('top')) return 'top';
  if (cat.includes('shoe')) return 'footwear';

  return 'accessory';
}

/**
 * 5-Step Precedence Occasion Classifier:
 * 1. Explicit normalized metadata (item.occasion_tags)
 * 2. Category mapping
 * 3. Product slug
 * 4. Product name keyword heuristics
 * 5. Unknown fallback
 */
export function classifyOccasion(item: CatalogItem): OccasionArchetype {
  if (item.occasion_tags && item.occasion_tags.length > 0) {
    return item.occasion_tags[0];
  }

  const text = `${item.category || ''} ${item.name || ''}`.toLowerCase();

  // Active / athletic
  if (/\b(active|activewear|gym|workout|yoga|athletic|running|leggings|biker shorts|sports bra|sweatpants|joggers|tracksuit|sneaker|trainer)\b/.test(text)) {
    return 'active';
  }

  // Formal / evening
  if (/\b(formal|evening|gown|cocktail|black tie|gala|luxury|silk|satin|clutch|stiletto|pumps|chiffon|velvet)\b/.test(text)) {
    return 'formal';
  }

  // Tailored / workwear
  if (/\b(tailored|blazer|suit|workwear|office|trousers|slacks|button-down|oxford|pencil skirt|loafer)\b/.test(text)) {
    return 'tailored';
  }

  // Streetwear
  if (/\b(streetwear|cargo|oversized|hoodie|graphic|distressed|bucket hat)\b/.test(text)) {
    return 'streetwear';
  }

  // Casual
  if (/\b(casual|everyday|denim|jeans|t-shirt|tee|shorts|flats|sandals|tote)\b/.test(text)) {
    return 'casual';
  }

  return 'unknown';
}

export function getOccasionCompatibility(target: OccasionArchetype, candidate: OccasionArchetype): number {
  return OCCASION_COMPATIBILITY[target]?.[candidate] ?? 0.40;
}

/**
 * Evaluates style/aesthetic alignment between target and candidate.
 */
function calculateStyleFit(
  target: CatalogItem,
  candidate: CatalogItem,
  targetOccasion: OccasionArchetype,
  candidateOccasion: OccasionArchetype,
): number {
  // Exact occasion match gives maximum style affinity
  if (targetOccasion !== 'unknown' && targetOccasion === candidateOccasion) {
    return 1.0;
  }

  // High synergy pairs (e.g. tailored jacket with casual denim or formal gown with tailored blazer)
  if (
    (targetOccasion === 'tailored' && candidateOccasion === 'formal') ||
    (targetOccasion === 'formal' && candidateOccasion === 'tailored') ||
    (targetOccasion === 'casual' && candidateOccasion === 'streetwear') ||
    (targetOccasion === 'streetwear' && candidateOccasion === 'casual')
  ) {
    return 0.85;
  }

  if (
    (targetOccasion === 'tailored' && candidateOccasion === 'casual') ||
    (targetOccasion === 'casual' && candidateOccasion === 'tailored')
  ) {
    return 0.70;
  }

  return 0.50;
}

/**
 * Calculates price tier balance between target and candidate to avoid jarring tier contrasts.
 */
function calculateTierBalance(targetPrice: number, candidatePrice: number): number {
  if (targetPrice <= 0 || candidatePrice <= 0) return 0.8;
  const ratio = Math.min(targetPrice, candidatePrice) / Math.max(targetPrice, candidatePrice);
  // Logarithmic scaling: items within 2x price ratio score > 0.8
  return Math.max(0.3, Math.min(1.0, ratio >= 0.2 ? 0.6 + ratio * 0.4 : ratio * 2));
}

/**
 * Recommends a cohesive, slot-deduped outfit for a target product.
 */
export function recommendCompleteTheLook(
  targetProduct: CatalogItem,
  catalog: CatalogItem[],
  limit = 4,
): LookRecommendation[] {
  if (!targetProduct || !catalog || catalog.length === 0) return [];

  const targetSlot = classifyClothingSlot(targetProduct);
  const targetOccasion = classifyOccasion(targetProduct);
  const targetColor = targetProduct.color || 'black';

  // Intimates are excluded from standard outfit completion
  const isTargetIntimates = targetSlot === 'intimates';

  // Retrieve blueprint for target slot
  const blueprint = OUTFIT_BLUEPRINTS[targetSlot] || [];
  if (blueprint.length === 0) return [];

  // Exclude target itself and intimates (unless anchor is intimates)
  const candidatePool = catalog.filter((p) => {
    if (p.id === targetProduct.id) return false;
    const slot = classifyClothingSlot(p);
    if (!isTargetIntimates && slot === 'intimates') return false;
    return true;
  });

  const slotWinners: LookRecommendation[] = [];

  // For each blueprint requirement in priority order, select AT MOST ONE best item
  for (const requirement of blueprint) {
    const slotCandidates = candidatePool.filter(
      (item) => classifyClothingSlot(item) === requirement.slot,
    );

    if (slotCandidates.length === 0) continue;

    const scoredInSlot: LookRecommendation[] = [];

    for (const item of slotCandidates) {
      const itemOccasion = classifyOccasion(item);
      const occasionFit = getOccasionCompatibility(targetOccasion, itemOccasion);

      // Hard zero-exclusion gate
      if (occasionFit <= 0) continue;

      const styleFit = calculateStyleFit(targetProduct, item, targetOccasion, itemOccasion);
      const itemColor = item.color || 'black';
      const harmony = evaluateColors([targetColor, itemColor]);
      const colorHarmony = Math.max(0, Math.min(1, harmony.score / 100));
      const tierBalance = calculateTierBalance(targetProduct.price, item.price);
      const merchBoost = item.on_sale ? 1.0 : 0.0;

      // Normalized multi-factor score: occasion(40) + style(25) + color(20) + tier(10) + merch(5)
      const score = Math.round(
        occasionFit * 40 +
        styleFit * 25 +
        colorHarmony * 20 +
        tierBalance * 10 +
        merchBoost * 5,
      );

      // Drop candidates below quality threshold
      if (score < MIN_SLOT_SCORE) continue;

      const reason =
        targetOccasion === itemOccasion && targetOccasion !== 'unknown'
          ? `${harmony.label} • Perfect ${targetOccasion} pairing`
          : `${harmony.label} color harmony`;

      scoredInSlot.push({
        product: item,
        slot: requirement.slot,
        harmony,
        score,
        reason,
      });
    }

    if (scoredInSlot.length === 0) continue;

    // Deterministic tie-breaking within slot: score DESC, on_sale DESC, price DESC, id ASC
    scoredInSlot.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bSale = b.product.on_sale ? 1 : 0;
      const aSale = a.product.on_sale ? 1 : 0;
      if (bSale !== aSale) return bSale - aSale;
      if (b.product.price !== a.product.price) return b.product.price - a.product.price;
      return a.product.id.localeCompare(b.product.id);
    });

    // Select the single highest-scoring item for this slot
    slotWinners.push(scoredInSlot[0]);

    if (slotWinners.length >= limit) break;
  }

  return slotWinners.slice(0, limit);
}
