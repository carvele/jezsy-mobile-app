-- Enable the pg_trgm extension for fuzzy string matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN indexes to speed up text searches and similarity matches
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON public.products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS categories_name_trgm_idx ON public.categories USING GIN (name gin_trgm_ops);

-- Create an RPC to perform fuzzy search across products and their categories
-- Using the % operator which returns true if similarity is above the threshold (default 0.3)
CREATE OR REPLACE FUNCTION public.search_catalog_fuzzy(search_term text, p_limit int DEFAULT 50)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
AS $BODY$
  SELECT p.*
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.deleted = false
    AND p.visibility = 'public'
    AND (
      p.name % search_term
      OR c.name % search_term
      OR p.name ILIKE '%' || search_term || '%'
      OR c.name ILIKE '%' || search_term || '%'
    )
  ORDER BY 
    GREATEST(
      similarity(p.name, search_term), 
      coalesce(similarity(c.name, search_term), 0)
    ) DESC,
    p.created_at DESC
  LIMIT p_limit;
$BODY$;

-- Grant execution to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.search_catalog_fuzzy(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_catalog_fuzzy(text, int) TO anon;
