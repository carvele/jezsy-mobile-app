-- F-001: RPC for catalog search, filtering, and sorting to allow server-side pagination
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
) RETURNS SETOF public.products AS $$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM public.products p
  WHERE p.visibility = 'public' AND p.deleted = false
    -- F-001: Support OR condition between search_query and category_ids for search mode
    AND (
      (search_query IS NULL AND category_ids IS NULL) OR
      (search_query IS NOT NULL AND category_ids IS NULL AND p.name ILIKE '%' || search_query || '%') OR
      (search_query IS NULL AND category_ids IS NOT NULL AND p.category_id = ANY(category_ids)) OR
      (search_query IS NOT NULL AND category_ids IS NOT NULL AND (p.name ILIKE '%' || search_query || '%' OR p.category_id = ANY(category_ids)))
    )
    AND (size_filters IS NULL OR p.sizes && size_filters)
    AND (color_filters IS NULL OR EXISTS (
          SELECT 1 FROM unnest(color_filters) AS c WHERE p.color ILIKE '%' || c || '%'
        ))
    AND (fit_filters IS NULL OR EXISTS (
          SELECT 1 FROM unnest(fit_filters) AS f WHERE p.fit_and_sizing ILIKE '%' || f || '%'
        ))
    AND (material_filters IS NULL OR EXISTS (
          SELECT 1 FROM unnest(material_filters) AS m WHERE p.material ILIKE '%' || m || '%'
        ))
    AND (tag_filters IS NULL OR p.tags && tag_filters)
    AND (NOT on_sale_only OR p.on_sale = true)
    AND (NOT new_arrivals_only OR (p.is_new_arrival = true AND p.created_at >= NOW() - INTERVAL '14 days'))
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    AND (min_price IS NULL OR COALESCE(p.sale_price, p.price) >= min_price)
    AND (max_price IS NULL OR COALESCE(p.sale_price, p.price) <= max_price)
  ORDER BY
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(p.sale_price, p.price) END ASC NULLS LAST,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(p.sale_price, p.price) END DESC NULLS LAST,
    CASE WHEN sort_by = 'newest' THEN p.created_at END DESC NULLS LAST,
    CASE WHEN sort_by = 'rating' THEN p.rating END DESC NULLS LAST,
    CASE WHEN sort_by = 'popular' THEN p.review_count END DESC NULLS LAST,
    CASE WHEN sort_by = 'recommended' THEN (p.stock IS NULL OR p.stock > 0) END DESC,
    p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
