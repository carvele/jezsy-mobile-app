/**
 * One reading of "can this be reserved".
 *
 * A null stock predates stock tracking and must read as available, not
 * sold out, or the whole legacy catalogue would disappear from any
 * stock-aware sort. Home and Explore both rank on this, and ProductCard
 * renders its badge from the same rule, so it lives in one place rather
 * than being restated per screen.
 */
export function isInStock(product: { stock?: number | null }): boolean {
  return product.stock == null || product.stock > 0;
}
