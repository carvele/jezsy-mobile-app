-- Migration: search_relevance_short_query_precision
-- Hardens search precision for short queries:
-- - Suppresses product results for 1-character queries (suggestions only).
-- - For 2-character queries (e.g. 'ac'): restricts matching strictly to exact and prefix matches
--   on category/subcategory/product names, preventing over-broad mid-word substring matches
--   (e.g. 'Bomber Jacket' or 'Necklace' matching 'ac').
-- - For 3-4 character queries: allows tags and category prefix matches.
-- - For 5+ character queries: allows broad substrings and description matching.
-- - 8-tier relevance ranking:
--   Tier 1: Exact product-name match
--   Tier 2: Exact category/subcategory match
--   Tier 3: Product-name prefix
--   Tier 4: Product word-level prefix
--   Tier 5: Category/subcategory prefix (length >= 3)
--   Tier 6: Brand/tag exact or prefix (length >= 3)
--   Tier 7: Substring in product name or category (length >= 5)
--   Tier 8: Description match (length >= 5)

CREATE OR REPLACE FUNCTION public.search_catalog(
  search_query text DEFAULT NULL::text,
  category_ids text[] DEFAULT NULL::text[],
  size_filters text[] DEFAULT NULL::text[],
  color_filters text[] DEFAULT NULL::text[],
  fit_filters text[] DEFAULT NULL::text[],
  material_filters text[] DEFAULT NULL::text[],
  tag_filters text[] DEFAULT NULL::text[],
  on_sale_only boolean DEFAULT false,
  new_arrivals_only boolean DEFAULT false,
  ar_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL::numeric,
  max_price numeric DEFAULT NULL::numeric,
  sort_by text DEFAULT 'recommended'::text
)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
AS $$
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
    -- Text search filter: length-governed precision
    AND (
      search_query IS NULL
      OR trim(search_query) = ''
      -- 1 char: suppressed entirely (suggestions only)
      OR (
        length(trim(search_query)) >= 2
        AND (
          -- Tier 1 & 3: Exact product name or product name / word prefix (all queries >= 2 chars)
          lower(trim(p.name)) = lower(trim(search_query))
          OR lower(trim(p.name)) LIKE lower(trim(search_query)) || '%'
          OR lower(p.name) LIKE '% ' || lower(trim(search_query)) || '%'
          -- Exact category/subcategory match (query matches full category name, e.g. "tops", "blouses")
          OR lower(trim(c.name)) = lower(trim(search_query))
          OR lower(trim(p.category)) = lower(trim(search_query))
          OR lower(trim(p.sub_category)) = lower(trim(search_query))
          OR rtrim(lower(trim(search_query)), 's') = rtrim(lower(trim(c.name)), 's')
          -- 3-4 chars: enable tags and category prefix matches
          OR (
            length(trim(search_query)) >= 3
            AND (
              (p.tags IS NOT NULL AND EXISTS (
                SELECT 1 FROM unnest(p.tags) t
                WHERE lower(trim(t)) = lower(trim(search_query))
                   OR lower(trim(t)) LIKE lower(trim(search_query)) || '%'
              ))
              OR lower(c.name) LIKE lower(trim(search_query)) || '%'
              OR lower(p.category) LIKE lower(trim(search_query)) || '%'
              OR lower(p.sub_category) LIKE lower(trim(search_query)) || '%'
            )
          )
          -- 5+ chars: enable broad substring, general tags, and description matching
          OR (
            length(trim(search_query)) >= 5
            AND (
              p.name ILIKE '%' || trim(search_query) || '%'
              OR c.name ILIKE '%' || trim(search_query) || '%'
              OR (p.tags IS NOT NULL AND EXISTS (
                SELECT 1 FROM unnest(p.tags) t
                WHERE lower(trim(t)) LIKE '%' || lower(trim(search_query)) || '%'
              ))
              OR (p.description IS NOT NULL AND p.description ILIKE '%' || trim(search_query) || '%')
            )
          )
        )
      )
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
    -- Primary sort by search relevance tier when search_query is present
    CASE
      WHEN search_query IS NOT NULL AND trim(search_query) <> '' THEN
        CASE
          -- 1. Exact product-name match
          WHEN lower(trim(p.name)) = lower(trim(search_query)) THEN 1
          -- 2. Exact category/subcategory match
          WHEN lower(trim(c.name)) = lower(trim(search_query))
            OR lower(trim(p.category)) = lower(trim(search_query))
            OR lower(trim(p.sub_category)) = lower(trim(search_query))
            OR rtrim(lower(trim(search_query)), 's') = rtrim(lower(trim(c.name)), 's')
            THEN 2
          -- 3. Product-name prefix
          WHEN lower(trim(p.name)) LIKE lower(trim(search_query)) || '%' THEN 3
          -- 4. Product word-level prefix (e.g. "Tee" or second word)
          WHEN lower(p.name) LIKE '% ' || lower(trim(search_query)) || '%' THEN 4
          -- 5. Category/subcategory prefix (length >= 3)
          WHEN length(trim(search_query)) >= 3
            AND (lower(c.name) LIKE lower(trim(search_query)) || '%'
              OR lower(p.category) LIKE lower(trim(search_query)) || '%'
              OR lower(p.sub_category) LIKE lower(trim(search_query)) || '%')
            THEN 5
          -- 6. Brand/tag exact or prefix (length >= 3)
          WHEN length(trim(search_query)) >= 3
            AND p.tags IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(p.tags) t
              WHERE lower(trim(t)) = lower(trim(search_query))
                 OR lower(trim(t)) LIKE lower(trim(search_query)) || '%'
            ) THEN 6
          -- 7. Substring in product name or category name (length >= 5)
          WHEN length(trim(search_query)) >= 5
            AND (p.name ILIKE '%' || trim(search_query) || '%' OR c.name ILIKE '%' || trim(search_query) || '%')
            THEN 7
          -- 8. Description match (length >= 5)
          WHEN length(trim(search_query)) >= 5
            AND p.description IS NOT NULL AND p.description ILIKE '%' || trim(search_query) || '%'
            THEN 8
          ELSE 9
        END
      ELSE 0
    END ASC,
    -- Secondary sort by selected sort option within each relevance tier
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
$$;
