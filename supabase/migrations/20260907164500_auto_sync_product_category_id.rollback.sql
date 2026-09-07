-- ============================================================================
-- Rollback: Remove auto_sync_product_category_id trigger and function
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_product_category_id ON public.products;
DROP FUNCTION IF EXISTS public.sync_product_category_id();

-- Restore previous search_catalog without defensive NULL fallback
CREATE OR REPLACE FUNCTION public.search_catalog(
  search_query text DEFAULT NULL,
  category_ids text[] DEFAULT NULL,
  size_filters text[] DEFAULT NULL,
  color_filters text[] DEFAULT NULL,
  fit_filters text[] DEFAULT NULL,
  material_filters text[] DEFAULT NULL,
  tag_filters text[] DEFAULT NULL,
  on_sale_only boolean DEFAULT false,
  new_arrivals_only boolean DEFAULT false,
  ar_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL,
  max_price numeric DEFAULT NULL,
  sort_by text DEFAULT 'recommended'
)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $BODY$
  SELECT p.*
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.deleted = false
    AND p.visibility = 'public'
    AND (
      category_ids IS NULL 
      OR cardinality(category_ids) = 0 
      OR p.category_id::text = ANY(category_ids)
    )
    AND (
      search_query IS NULL 
      OR trim(search_query) = ''
      OR p.name ILIKE '%' || trim(search_query) || '%'
      OR c.name ILIKE '%' || trim(search_query) || '%'
    )
    AND (NOT on_sale_only OR p.on_sale = true)
    AND (NOT new_arrivals_only OR p.is_new_arrival = true OR p.created_at >= (NOW() - INTERVAL '30 days'))
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    AND (
      min_price IS NULL 
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) >= min_price
    )
    AND (
      max_price IS NULL 
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) <= max_price
    )
    AND (size_filters IS NULL OR cardinality(size_filters) = 0 OR p.sizes && size_filters)
    AND (
      color_filters IS NULL 
      OR cardinality(color_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(color_filters) AS cf
        WHERE p.color ILIKE '%' || trim(cf) || '%' OR p.base_color ILIKE '%' || trim(cf) || '%'
      )
    )
    AND (
      fit_filters IS NULL 
      OR cardinality(fit_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(fit_filters) AS ff
        WHERE p.fit_and_sizing ILIKE '%' || trim(ff) || '%'
      )
    )
    AND (
      material_filters IS NULL 
      OR cardinality(material_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(material_filters) AS mf
        WHERE p.material ILIKE '%' || trim(mf) || '%'
      )
    )
    AND (tag_filters IS NULL OR cardinality(tag_filters) = 0 OR p.tags && tag_filters)
  ORDER BY
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END DESC,
    CASE WHEN sort_by = 'rating' THEN COALESCE(p.rating, 0) END DESC,
    CASE WHEN sort_by = 'popular' THEN COALESCE(p.review_count, 0) END DESC,
    p.created_at DESC,
    p.id ASC;
$BODY$;

GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text) TO anon;
