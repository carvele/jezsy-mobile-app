-- Catalog search that behaves like a storefront search, replacing the
-- name-only ILIKE version.
--
-- What was wrong with the live search_catalog:
--   * A text query plus a category was OR'd, so choosing a category and typing
--     a term returned the WHOLE category plus matches elsewhere. Filters must
--     narrow, never broaden.
--   * Only the product name was searched (no category, tags or description),
--     and results had no relevance ranking.
--
-- What this does (same 15-argument signature, so callers are unchanged):
--   * Every selected facet and the category are mandatory AND predicates; the
--     search text narrows within them.
--   * Prefix matching per token ("bla" finds "Blazer", "cardi jack" finds
--     "Cardigan"/"Jacket"), with English stemming ("dresses" finds "dress").
--   * Field weighting: name (A) > category/sub-category/tags (B) > description (C).
--   * Typo tolerance via pg_trgm word similarity (>= 0.4), as a fallback OR
--     beside the full-text match. Limited to single-word queries of 5+
--     characters: on short words ("ring" also matching "earrings") and on
--     multi-word strings it added unrelated products, so those rely on
--     full-text prefix matching only. Threshold tuned against the live catalog.
--   * Relevance ranking when sort_by = 'recommended'; in-stock stays first.
--
-- 20260920150000_faceted_search_catalog.sql (never applied) tried the AND fix
-- but used pure full-text (no prefix) and an index expression containing
-- array_to_string, which is only STABLE and is rejected in an index
-- expression. The IMMUTABLE wrapper below avoids that.

-- plpgsql (not sql) on purpose: a plpgsql function is never inlined, so the
-- planner sees this exact call and can match it to the index expression.
CREATE OR REPLACE FUNCTION public.product_search_vector(
  p_name text,
  p_description text,
  p_category text,
  p_sub_category text,
  p_tags text[]
)
RETURNS tsvector
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RETURN setweight(to_tsvector('english', coalesce(p_name, '')), 'A')
      || setweight(to_tsvector('english',
           coalesce(p_category, '') || ' ' || coalesce(p_sub_category, '') || ' ' ||
           coalesce(array_to_string(p_tags, ' '), '')), 'B')
      || setweight(to_tsvector('english', coalesce(p_description, '')), 'C');
END;
$function$;

CREATE INDEX IF NOT EXISTS products_catalog_search_vector_idx
  ON public.products
  USING gin (public.product_search_vector(name, description, category, sub_category, tags))
  WHERE visibility = 'public' AND deleted = false;

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
  sort_by text DEFAULT 'recommended'::text,
  my_size_only boolean DEFAULT false,
  user_measurements jsonb DEFAULT NULL::jsonb
)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH q AS (
    -- Letters/digits only: this string is interpolated into a tsquery, so
    -- nothing else may reach it.
    SELECT lower(btrim(regexp_replace(coalesce(search_query, ''), '[^[:alnum:][:space:]]+', ' ', 'g'))) AS raw
  ),
  t AS (
    SELECT
      q.raw,
      CASE WHEN q.raw = '' THEN NULL ELSE (
        SELECT to_tsquery('english', string_agg(tok || ':*', ' & '))
        FROM unnest(regexp_split_to_array(q.raw, '\s+')) AS tok
        WHERE tok <> ''
      ) END AS tsq
    FROM q
  )
  SELECT p.*
  FROM public.products p
  CROSS JOIN t
  WHERE p.visibility = 'public'
    AND p.deleted = false
    AND (category_ids IS NULL OR p.category_id::text = ANY(category_ids))
    AND (
      t.raw = ''
      OR public.product_search_vector(p.name, p.description, p.category, p.sub_category, p.tags) @@ t.tsq
      OR (length(t.raw) >= 5 AND position(' ' in t.raw) = 0
          AND extensions.word_similarity(t.raw, lower(p.name)) >= 0.4)
    )
    AND (size_filters IS NULL OR p.sizes && size_filters)
    AND (
      color_filters IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(color_filters) AS c
        WHERE p.color ILIKE '%' || c || '%' OR p.base_color ILIKE '%' || c || '%'
      )
    )
    AND (
      fit_filters IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(fit_filters) AS f
        WHERE p.fit_and_sizing ILIKE '%' || f || '%'
      )
    )
    AND (
      material_filters IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(material_filters) AS m
        WHERE p.material ILIKE '%' || m || '%'
      )
    )
    AND (tag_filters IS NULL OR p.tags && tag_filters)
    AND (NOT on_sale_only OR p.on_sale = true)
    AND (NOT new_arrivals_only OR p.is_new_arrival = true)
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    AND (min_price IS NULL OR COALESCE(p.sale_price, p.price) >= min_price)
    AND (max_price IS NULL OR COALESCE(p.sale_price, p.price) <= max_price)
    AND (
      NOT my_size_only
      OR (
        user_measurements IS NOT NULL
        AND public.recommend_size(user_measurements, p.measurements, (SELECT name FROM public.categories c WHERE c.id = p.category_id LIMIT 1)) = ANY(p.sizes)
      )
    )
  ORDER BY
    CASE WHEN p.stock > 0 THEN 0 ELSE 1 END ASC,
    CASE WHEN sort_by = 'recommended' AND t.raw <> '' THEN
      coalesce(ts_rank(public.product_search_vector(p.name, p.description, p.category, p.sub_category, p.tags), t.tsq), 0) * 2
      + extensions.word_similarity(t.raw, lower(p.name))
    END DESC NULLS LAST,
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(p.sale_price, p.price) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(p.sale_price, p.price) END DESC,
    CASE WHEN sort_by = 'popular' THEN p.review_count END DESC,
    CASE WHEN sort_by = 'bestSelling' THEN public.get_product_sold_count(p.id) END DESC,
    CASE WHEN sort_by = 'rating' THEN p.rating END DESC,
    p.created_at DESC,
    p.id ASC;
$function$;

-- search_catalog is SECURITY INVOKER and anon shoppers call it, so the helper
-- must be executable by both roles. It is a pure text function with no table
-- access, so there is nothing to protect.
GRANT EXECUTE ON FUNCTION public.product_search_vector(text, text, text, text, text[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text, boolean, jsonb) TO authenticated, anon;
