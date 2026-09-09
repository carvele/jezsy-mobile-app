-- 'recommended' and 'newest' had no dedicated ORDER BY CASE branch, so both
-- silently fell through to the same `p.created_at DESC` tiebreaker -- two
-- distinct, separately-labeled sort options that produced byte-identical
-- results. Verified live: only 2/25 public products have any review, but 5
-- have wishlist activity, so a review-only signal would be nearly useless
-- for "Recommended" today. Blends wishlist saves (real, available signal),
-- reviewed quality (rating * review_count, zero when unreviewed so it never
-- outranks genuine engagement with an unearned high average from one
-- review), and a mild 14-day recency boost -- falling back to the existing
-- created_at/id tiebreakers for the long tail with no signal at all, same
-- as today's placeholder behavior.
CREATE OR REPLACE FUNCTION public.search_catalog(search_query text DEFAULT NULL::text, category_ids text[] DEFAULT NULL::text[], size_filters text[] DEFAULT NULL::text[], color_filters text[] DEFAULT NULL::text[], fit_filters text[] DEFAULT NULL::text[], material_filters text[] DEFAULT NULL::text[], tag_filters text[] DEFAULT NULL::text[], on_sale_only boolean DEFAULT false, new_arrivals_only boolean DEFAULT false, ar_only boolean DEFAULT false, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, sort_by text DEFAULT 'recommended'::text)
RETURNS SETOF products
LANGUAGE sql
STABLE
AS $function$
  SELECT p.*
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.deleted = false
    AND p.visibility = 'public'
    -- Category filter: canonical category_id comparison, with strict fallback ONLY when category_id is NULL
    AND (
      category_ids IS NULL
      OR cardinality(category_ids) = 0
      OR p.category_id::text = ANY(category_ids)
      OR (
        p.category_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.categories sub
          JOIN public.categories parent ON parent.id = sub.parent_id
          WHERE sub.id::text = ANY(category_ids)
            AND lower(trim(sub.name)) = lower(trim(p.sub_category))
            AND lower(trim(parent.name)) = lower(trim(p.category))
        )
      )
    )
    -- Text search filter across product name and category name
    AND (
      search_query IS NULL
      OR trim(search_query) = ''
      OR p.name ILIKE '%' || trim(search_query) || '%'
      OR c.name ILIKE '%' || trim(search_query) || '%'
    )
    -- On sale filter
    AND (NOT on_sale_only OR p.on_sale = true)
    -- New arrivals filter (within 30 days)
    AND (NOT new_arrivals_only OR p.is_new_arrival = true OR p.created_at >= (NOW() - INTERVAL '30 days'))
    -- AR filter
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    -- Price filters
    AND (
      min_price IS NULL
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) >= min_price
    )
    -- Price max filter
    AND (
      max_price IS NULL
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) <= max_price
    )
    -- Size filter (array overlap)
    AND (size_filters IS NULL OR cardinality(size_filters) = 0 OR p.sizes && size_filters)
    -- Color filter
    AND (
      color_filters IS NULL
      OR cardinality(color_filters) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(color_filters) AS cf
        WHERE p.color ILIKE '%' || trim(cf) || '%' OR p.base_color ILIKE '%' || trim(cf) || '%'
      )
    )
    -- Fit filter
    AND (
      fit_filters IS NULL
      OR cardinality(fit_filters) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(fit_filters) AS ff
        WHERE p.fit_and_sizing ILIKE '%' || trim(ff) || '%'
      )
    )
    -- Material filter
    AND (
      material_filters IS NULL
      OR cardinality(material_filters) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(material_filters) AS mf
        WHERE p.material ILIKE '%' || trim(mf) || '%'
      )
    )
    -- Tag filter
    AND (tag_filters IS NULL OR cardinality(tag_filters) = 0 OR p.tags && tag_filters)
  ORDER BY
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END DESC,
    CASE WHEN sort_by = 'rating' THEN COALESCE(p.rating, 0) END DESC,
    CASE WHEN sort_by = 'popular' THEN COALESCE(p.review_count, 0) END DESC,
    CASE WHEN sort_by = 'recommended' THEN
      COALESCE(p.rating, 0) * COALESCE(p.review_count, 0)
      + 3 * (SELECT COUNT(*) FROM public.wishlists w WHERE w.product_id = p.id)
      + GREATEST(0, 14 - EXTRACT(DAY FROM (NOW() - p.created_at)))
    END DESC,
    p.created_at DESC,
    p.id ASC;
$function$;
