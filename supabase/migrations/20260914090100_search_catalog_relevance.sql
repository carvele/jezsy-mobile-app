-- Migration: search_catalog_relevance
-- Adds multi-tier search relevance ranking to search_catalog RPC:
-- Tier 1: Exact category/subcategory match
-- Tier 2: Exact product name match
-- Tier 3: Product name starts with query
-- Tier 4: Tag/keyword match
-- Tier 5: Substring in product name or category
-- Tier 6: Substring in description
-- Secondary sort (price, rating, popular, recommended) is respected within each relevance tier.

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
    -- Text search filter across product name, category name, tags, and description
    AND (
      search_query IS NULL
      OR trim(search_query) = ''
      OR p.name ILIKE '%' || trim(search_query) || '%'
      OR c.name ILIKE '%' || trim(search_query) || '%'
      OR (p.tags IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(p.tags) t WHERE lower(trim(t)) LIKE '%' || lower(trim(search_query)) || '%'
      ))
      OR (p.description IS NOT NULL AND p.description ILIKE '%' || trim(search_query) || '%')
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
          -- Tier 1: Exact category or subcategory match
          WHEN lower(trim(c.name)) = lower(trim(search_query))
            OR lower(trim(p.category)) = lower(trim(search_query))
            OR lower(trim(p.sub_category)) = lower(trim(search_query))
            OR rtrim(lower(trim(search_query)), 's') = rtrim(lower(trim(c.name)), 's')
            THEN 1
          -- Tier 2: Exact product name match
          WHEN lower(trim(p.name)) = lower(trim(search_query))
            THEN 2
          -- Tier 3: Product name starts with search query
          WHEN lower(trim(p.name)) LIKE lower(trim(search_query)) || '%'
            THEN 3
          -- Tier 4: Tag / keyword match
          WHEN p.tags IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(p.tags) t WHERE lower(trim(t)) LIKE '%' || lower(trim(search_query)) || '%'
          ) THEN 4
          -- Tier 5: Substring in product name or category name
          WHEN p.name ILIKE '%' || trim(search_query) || '%'
            OR c.name ILIKE '%' || trim(search_query) || '%'
            THEN 5
          -- Tier 6: Description match
          ELSE 6
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
