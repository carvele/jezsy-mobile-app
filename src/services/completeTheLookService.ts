import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { recommendCompleteTheLook, CatalogItem } from '@/src/utils/completeTheLook';

type Product = Database['public']['Tables']['products']['Row'];
type Inventory = Database['public']['Tables']['inventory']['Row'];

export type CompleteTheLookOrigin = 'manual' | 'styled_look_suggestion' | 'algorithmic_suggestion';

export interface CompleteTheLookItem {
  product: Product;
  /** Only the variants that actually pass the sellability predicate below --
   * the UI must never offer a size/color that isn't really purchasable. */
  sellableVariants: Inventory[];
  tier: CompleteTheLookOrigin;
}

const DEFAULT_LIMIT = 6;
/** How many products the Tier 3 heuristic scores against, mirroring the
 * existing CompleteTheLookSection.tsx teaser's own catalog fetch size. */
const HEURISTIC_CATALOG_SIZE = 50;

const toCatalogItem = (product: Product): CatalogItem => ({
  id: product.id,
  name: product.name,
  category: product.category,
  category_id: product.category_id,
  color: product.color,
  price: product.price ?? 0,
  sale_price: product.sale_price,
  on_sale: product.on_sale,
  image_url: product.image_url ?? '',
});

async function fetchSellableVariantsByProduct(productIds: string[]): Promise<Map<string, Inventory[]>> {
  const map = new Map<string, Inventory[]>();
  if (productIds.length === 0) return map;

  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .in('product_doc_id', productIds)
    .eq('deleted', false)
    .gt('available', 0);
  if (error) throw error;

  for (const row of data || []) {
    if (!row.product_doc_id) continue;
    const list = map.get(row.product_doc_id) || [];
    list.push(row);
    map.set(row.product_doc_id, list);
  }
  return map;
}

/**
 * Canonical sellability predicate: not soft-deleted, publicly visible, and
 * has at least one in-stock (available > 0), non-deleted inventory variant.
 * Filters first, in the caller's own tier ordering, so a caller can then do
 * simple slot accounting (push until `limit`) without re-sorting -- keeping
 * "eligibility first, then slot accounting" as two separate, simple passes
 * rather than one function trying to do both at once.
 */
async function toSellableItems(products: Product[], tier: CompleteTheLookOrigin): Promise<CompleteTheLookItem[]> {
  const eligible = products.filter((p) => !p.deleted && p.visibility === 'public');
  const variantsByProduct = await fetchSellableVariantsByProduct(eligible.map((p) => p.id));

  return eligible
    .map((product) => ({ product, sellableVariants: variantsByProduct.get(product.id) || [], tier }))
    .filter((item) => item.sellableVariants.length > 0);
}

/**
 * The hybrid recommendation hierarchy: Explicit Curated (product_complements)
 * -> Styled Look Siblings (pose_guide_products) -> Algorithmic Fallback
 * (existing color/category heuristic). Each tier only runs if the previous
 * one(s) haven't already filled `limit` slots. Dedup order matches the
 * frozen plan exactly: exclude the anchor -> add Tier 1 -> add Tier 2
 * (deduped against the anchor + Tier 1) -> add Tier 3 (deduped against all
 * of the above).
 */
export async function getCompleteTheLook(productId: string, limit = DEFAULT_LIMIT): Promise<CompleteTheLookItem[]> {
  const excludeIds = new Set<string>([productId]);
  const results: CompleteTheLookItem[] = [];

  const pushUpToLimit = (items: CompleteTheLookItem[]) => {
    for (const item of items) {
      if (results.length >= limit) break;
      if (excludeIds.has(item.product.id)) continue;
      results.push(item);
      excludeIds.add(item.product.id);
    }
  };

  // ---- Tier 1: Explicit curated links (product_complements) ----
  // product_complements only exposes id/product_id/complementary_product_id/
  // sort_order to clients (see its migration) -- audit columns are not
  // selectable here by design, not an oversight.
  const { data: curatedLinks, error: curatedErr } = await supabase
    .from('product_complements')
    .select('complementary_product_id, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('complementary_product_id', { ascending: true });
  if (curatedErr) throw curatedErr;

  if (curatedLinks && curatedLinks.length > 0) {
    const ids = curatedLinks.map((l) => l.complementary_product_id);
    const { data: curatedProducts, error: cpErr } = await supabase.from('products').select('*').in('id', ids);
    if (cpErr) throw cpErr;

    const byId = new Map((curatedProducts || []).map((p) => [p.id, p]));
    // Re-apply the curated sort_order/id ordering -- an `IN` query does not
    // preserve the order its id list was passed in.
    const ordered = curatedLinks
      .map((l) => byId.get(l.complementary_product_id))
      .filter((p): p is Product => !!p);

    pushUpToLimit(await toSellableItems(ordered, 'manual'));
  }

  if (results.length >= limit) return results;

  // ---- Tier 2: Styled Look siblings (pose_guide_products) ----
  const { data: anchorPoses, error: poseErr } = await supabase
    .from('pose_guide_products')
    .select('pose_guide_id')
    .eq('product_id', productId);
  if (poseErr) throw poseErr;

  if (anchorPoses && anchorPoses.length > 0) {
    const poseIds = anchorPoses.map((p) => p.pose_guide_id);
    const { data: siblingLinks, error: sibErr } = await supabase
      .from('pose_guide_products')
      .select('product_id, sort_order')
      .in('pose_guide_id', poseIds);
    if (sibErr) throw sibErr;

    // shared_look_count = how many of the anchor's own looks this sibling
    // also appears in; minSortOrder = its best (lowest) real sort_order
    // across those shared looks, used as the tiebreak.
    const agg = new Map<string, { count: number; minSortOrder: number }>();
    for (const row of siblingLinks || []) {
      if (row.product_id === productId) continue;
      const sortOrder = row.sort_order ?? 0;
      const entry = agg.get(row.product_id);
      if (entry) {
        entry.count += 1;
        entry.minSortOrder = Math.min(entry.minSortOrder, sortOrder);
      } else {
        agg.set(row.product_id, { count: 1, minSortOrder: sortOrder });
      }
    }

    const siblingIds = [...agg.keys()];
    if (siblingIds.length > 0) {
      const { data: siblingProducts, error: spErr } = await supabase.from('products').select('*').in('id', siblingIds);
      if (spErr) throw spErr;

      const ordered = (siblingProducts || []).slice().sort((a, b) => {
        const aAgg = agg.get(a.id)!;
        const bAgg = agg.get(b.id)!;
        if (bAgg.count !== aAgg.count) return bAgg.count - aAgg.count;
        if (aAgg.minSortOrder !== bAgg.minSortOrder) return aAgg.minSortOrder - bAgg.minSortOrder;
        return a.id.localeCompare(b.id);
      });

      pushUpToLimit(await toSellableItems(ordered, 'styled_look_suggestion'));
    }
  }

  if (results.length >= limit) return results;

  // ---- Tier 3: Algorithmic fallback (existing color/category heuristic) ----
  const { data: anchorProduct, error: anchorErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();
  if (anchorErr) throw anchorErr;
  if (!anchorProduct) return results;

  const { data: catalog, error: catalogErr } = await supabase
    .from('products')
    .select('*')
    .eq('deleted', false)
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(HEURISTIC_CATALOG_SIZE);
  if (catalogErr) throw catalogErr;

  const candidatePool = (catalog || []).filter((p) => !excludeIds.has(p.id));
  const scored = recommendCompleteTheLook(
    toCatalogItem(anchorProduct),
    candidatePool.map(toCatalogItem),
    candidatePool.length,
  );
  const heuristicOrder = scored
    .slice()
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.product.id.localeCompare(b.product.id)))
    .map((s) => s.product.id);

  const byId = new Map(candidatePool.map((p) => [p.id, p]));
  const orderedFull = heuristicOrder.map((id) => byId.get(id)).filter((p): p is Product => !!p);

  pushUpToLimit(await toSellableItems(orderedFull, 'algorithmic_suggestion'));

  return results;
}
