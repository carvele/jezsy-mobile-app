/**
 * One reading of "does this product get the NEW badge".
 *
 * A staff-set is_new_arrival flag alone drifts -- nothing un-sets it once
 * the product is no longer new, so it silently ages into inaccuracy. Gating
 * it on a rolling window (14 days, the fast-turnover e-commerce convention)
 * makes the badge self-expiring while still letting staff opt a product out
 * early by clearing the flag. ProductCard and Explore's filter both read
 * this so the rule lives in one place.
 */
const NEW_ARRIVAL_WINDOW_DAYS = 14;

export function isNewArrival(product: { is_new_arrival?: boolean | null; created_at?: string | null }): boolean {
  if (!product.is_new_arrival || !product.created_at) return false;

  const ageMs = Date.now() - new Date(product.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays <= NEW_ARRIVAL_WINDOW_DAYS;
}
