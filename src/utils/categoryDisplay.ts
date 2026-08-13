/**
 * Shared helpers for reading category info via the `products.category_id` FK
 * join, replacing the old `products.category` / `products.sub_category` text
 * columns (retired 2026-07-20 — see the taxonomy rebuild migrations).
 *
 * `products.category_id` always points at a SUBCATEGORY row (never a
 * top-level one), so a product's main category is its subcategory's parent.
 */

// Pass to .select() alongside '*' to embed both the subcategory and its
// parent (main) category in one query.
//
// Hint syntax notes (this bit is fiddly, and was wrong before -- verified
// live against the PostgREST API, not just reasoned about):
//   * Outer embed uses the CONSTRAINT name (products_category_id_fkey) because
//     it's a FK between two different tables (products -> categories); exactly
//     one relationship matches, so the constraint name resolves cleanly.
//   * Inner "parent" embed is a SELF-reference (categories.parent_id ->
//     categories.id). The constraint name doesn't resolve at all here
//     (PGRST200 "no relationship found", even after a schema cache reload --
//     self-referencing constraints aren't indexed the same way). Hinting by
//     TABLE!COLUMN ("categories!parent_id") does resolve without erroring,
//     but silently picks the WRONG direction: it returns this row's
//     CHILDREN (an array, empty for every leaf subcategory, since a
//     subcategory never has children of its own) rather than its parent --
//     which is exactly why every product's main-category label fell back to
//     "COLLECTION" no matter what its actual category was. The direction
//     that actually resolves correctly (a single object, the real parent)
//     is the BARE column name as the embed spec: "parent:parent_id(...)",
//     with no table prefix.
export const CATEGORY_SELECT =
  'categories!products_category_id_fkey(id, name, parent:parent_id(id, name))';

type ParentRef = { id: string; name: string };

// Supabase's type generator infers the nested self-join (parent_id) as an
// array rather than a single object — a known quirk with self-referencing
// FKs it can't always prove are to-one. PostgREST's actual runtime behavior
// for embedding via the FK-holding side (a subcategory has exactly one
// parent_id) is a single object or null, but rather than gamble on that,
// every accessor below handles both shapes.
export type CategoryEmbed = {
  id: string;
  name: string;
  parent: ParentRef | ParentRef[] | null;
} | null;

export type WithCategoryEmbed = {
  categories?: CategoryEmbed;
};

const firstOf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
};

/** Subcategory id, e.g. the "T-Shirts" row's own id. */
export const getSubCategoryId = (product: WithCategoryEmbed): string | null =>
  product.categories?.id ?? null;

/** Subcategory name, e.g. "T-Shirts". */
export const getSubCategoryName = (product: WithCategoryEmbed): string | null =>
  product.categories?.name ?? null;

/** Main category id, e.g. the "Tops" row's own id — for querying "everything
 * else in this main category" (a product's own category_id points one level
 * down, at its subcategory). */
export const getMainCategoryId = (product: WithCategoryEmbed): string | null =>
  firstOf(product.categories?.parent)?.id ?? null;

/** Main category name, e.g. "Tops". */
export const getMainCategoryName = (product: WithCategoryEmbed): string | null =>
  firstOf(product.categories?.parent)?.name ?? null;

/**
 * Display label matching the previous `sub_category || category || fallback`
 * convention used across product cards, search results, and wishlist rows.
 */
export const getCategoryLabel = (product: WithCategoryEmbed, fallback = 'Item'): string =>
  getSubCategoryName(product) ?? getMainCategoryName(product) ?? fallback;
