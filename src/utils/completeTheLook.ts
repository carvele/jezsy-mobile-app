/**
 * completeTheLook.ts
 * AI Stylist recommendation engine for matching current viewed product
 * with complementary catalog items (e.g., Dress -> Shoes, Bag, Accessories)
 * using color harmony and category affinity rules.
 */

import { evaluateColors, ColorMatchResult } from "./colorMatcher";

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
}

export interface LookRecommendation {
  product: CatalogItem;
  harmony: ColorMatchResult;
  score: number;
  reason: string;
}

// Category complement mapping rules
const COMPLEMENTARY_CATEGORIES: Record<string, string[]> = {
  dress: ["shoes", "heels", "bag", "handbag", "jewelry", "accessory", "outerwear"],
  gown: ["shoes", "heels", "clutch", "jewelry", "earrings", "necklace"],
  top: ["skirt", "pants", "trousers", "shoes", "jacket", "outerwear"],
  blouse: ["skirt", "pants", "shorts", "heels", "bag"],
  skirt: ["top", "blouse", "heels", "shoes", "bag"],
  pants: ["top", "blouse", "jacket", "shoes"],
  suit: ["shoes", "shirt", "blouse", "tie", "watch"],
  outerwear: ["dress", "top", "pants", "boots", "scarf"],
};

/**
 * Recommends complementary catalog items to "Complete the Look" for a target product.
 */
export function recommendCompleteTheLook(
  targetProduct: CatalogItem,
  catalog: CatalogItem[],
  limit = 4,
): LookRecommendation[] {
  if (!targetProduct || !catalog || catalog.length === 0) return [];

  const targetCategory = (targetProduct.category || "").toLowerCase();
  const targetColor = targetProduct.color || "black";

  // Filter out the target product itself
  const candidates = catalog.filter((p) => p.id !== targetProduct.id);

  // Determine priority target complement categories
  let preferredCategories: string[] = [];
  for (const [key, complements] of Object.entries(COMPLEMENTARY_CATEGORIES)) {
    if (targetCategory.includes(key)) {
      preferredCategories = complements;
      break;
    }
  }

  // Fallback: any category except the target category
  if (preferredCategories.length === 0) {
    preferredCategories = ["shoes", "bag", "accessory", "jewelry"];
  }

  const scored: LookRecommendation[] = [];

  candidates.forEach((item) => {
    const itemCat = (item.category || "").toLowerCase();
    const itemColor = item.color || "black";

    // 1. Category relevance bonus
    const isCategoryMatch = preferredCategories.some(
      (cat) => itemCat.includes(cat) || cat.includes(itemCat),
    );

    // 2. Color harmony evaluation
    const harmony = evaluateColors([targetColor, itemColor]);

    let score = harmony.score;

    if (isCategoryMatch) {
      score += 15; // Category synergy boost
    }

    if (item.on_sale) {
      score += 5; // Slight boost for sale items
    }

    const reason = isCategoryMatch
      ? `Matches ${harmony.label.toLowerCase()} with ${item.name}`
      : `${harmony.label} color match`;

    scored.push({
      product: item,
      harmony,
      score,
      reason,
    });
  });

  // Sort descending by combined score and limit results
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
