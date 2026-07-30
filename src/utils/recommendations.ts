// Ranking for the "You May Also Like" strip. There is no recommendation
// service behind this: the signals are the ones already on the device
// (wishlist, recently viewed), which is why scoring lives here as plain
// arithmetic rather than anything server-side.

const SAME_SUBCATEGORY = 3;
const AFFINITY_CATEGORY = 2;
const ON_SALE = 1;
// Caps at 2.0 for a 5-star item, so rating breaks ties but never outranks
// a genuine category match.
const RATING_WEIGHT = 0.4;

export type Candidate = {
  category_id: string | null;
  on_sale: boolean | null;
  rating: number | null;
};

export type RecommendationSignals = {
  currentSubCategoryId: string | null;
  affinityCategoryIds: Set<string>;
};

export function scoreCandidate(product: Candidate, signals: RecommendationSignals): number {
  let score = 0;

  if (signals.currentSubCategoryId && product.category_id === signals.currentSubCategoryId) {
    score += SAME_SUBCATEGORY;
  }
  if (product.category_id && signals.affinityCategoryIds.has(product.category_id)) {
    score += AFFINITY_CATEGORY;
  }
  if (product.on_sale) {
    score += ON_SALE;
  }
  score += Math.min(Math.max(product.rating ?? 0, 0), 5) * RATING_WEIGHT;

  return score;
}

export function rankCandidates<T extends Candidate>(
  products: T[],
  signals: RecommendationSignals,
  limit: number,
): T[] {
  return [...products]
    .sort((a, b) => scoreCandidate(b, signals) - scoreCandidate(a, signals))
    .slice(0, limit);
}
