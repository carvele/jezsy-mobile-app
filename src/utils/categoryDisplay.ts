/**
 * Shared helpers for reading category info via the `products.category_id` FK
 * join, replacing the old `products.category` / `products.sub_category` text
 * columns (retired 2026-07-20 — see the taxonomy rebuild migrations).
 *
 * `products.category_id` always points at a SUBCATEGORY row (never a
 * top-level one), so a product's main category is its subcategory's parent.
 */

// Pass to .select() alongside '*' to embed both the subcategory and its
// parent (main) category in one query. Constraint names are given explicitly
// since categories self-references via parent_id (a bare `categories(...)`
// embed would be ambiguous).
export const CATEGORY_SELECT =
  'categories!products_category_id_fkey(id, name, parent:categories!categories_parent_id_fkey(id, name))';

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
