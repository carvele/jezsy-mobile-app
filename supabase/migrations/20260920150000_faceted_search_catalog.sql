-- Keep selected facets as mandatory predicates. Search terms narrow the
-- already-filtered catalog; they must never broaden it with an OR branch.
CREATE INDEX IF NOT EXISTS products_catalog_search_vector_idx
  ON public.products
  USING gin (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(category, '') || ' ' || coalesce(sub_category, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  )
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
  SELECT p.*
  FROM public.products p
  WHERE p.visibility = 'public'
    AND p.deleted = false
    AND (category_ids IS NULL OR p.category_id::text = ANY(category_ids))
    AND (
      NULLIF(btrim(search_query), '') IS NULL
      OR to_tsvector(
        'english',
        coalesce(p.name, '') || ' ' || coalesce(p.description, '') || ' ' ||
        coalesce(p.category, '') || ' ' || coalesce(p.sub_category, '') || ' ' ||
        coalesce(array_to_string(p.tags, ' '), '')
      ) @@ websearch_to_tsquery('english', search_query)
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
    CASE WHEN sort_by = 'recommended' AND NULLIF(btrim(search_query), '') IS NOT NULL THEN
      ts_rank(
        to_tsvector('english',
          coalesce(p.name, '') || ' ' || coalesce(p.description, '') || ' ' ||
          coalesce(p.category, '') || ' ' || coalesce(p.sub_category, '') || ' ' ||
          coalesce(array_to_string(p.tags, ' '), '')
        ),
        websearch_to_tsquery('english', search_query)
      )
    END DESC,
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(p.sale_price, p.price) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(p.sale_price, p.price) END DESC,
    CASE WHEN sort_by = 'popular' THEN p.review_count END DESC,
    CASE WHEN sort_by = 'bestSelling' THEN public.get_product_sold_count(p.id) END DESC,
    CASE WHEN sort_by = 'rating' THEN p.rating END DESC,
    p.created_at DESC,
    p.id ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text, boolean, jsonb) TO authenticated, anon;
