-- Migration: 20260914070000_normalize_and_sort_product_sizes.sql
-- Description: Canonicalize and sort product apparel sizes across all products in public.products.
-- Invariants:
--   1. Normalizes size aliases (e.g. 'XXL' -> '2XL', 'Free Size' -> 'One Size').
--   2. Enforces canonical apparel hierarchy (XXS -> XS -> S -> M -> L -> XL -> 2XL -> 3XL -> 4XL...).
--   3. Preserves natural numeric ordering (e.g. 36, 37, 38).
--   4. Preserves custom/unknown size tokens deterministically at the end.
--   5. Strips empty strings, whitespace-only entries, and duplicates.

CREATE OR REPLACE FUNCTION public.canonicalize_size_token(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE LOWER(TRIM(COALESCE(raw, '')))
    WHEN 'xxl' THEN '2XL'
    WHEN '2xl' THEN '2XL'
    WHEN 'xxxl' THEN '3XL'
    WHEN '3xl' THEN '3XL'
    WHEN 'xxxxl' THEN '4XL'
    WHEN '4xl' THEN '4XL'
    WHEN 'free size' THEN 'One Size'
    WHEN 'freesize' THEN 'One Size'
    WHEN 'os' THEN 'One Size'
    WHEN 'one size' THEN 'One Size'
    WHEN 'onesize' THEN 'One Size'
    WHEN 'one-size' THEN 'One Size'
    WHEN '3xs' THEN '3XS'
    WHEN 'xxs' THEN 'XXS'
    WHEN 'xs' THEN 'XS'
    WHEN 's' THEN 'S'
    WHEN 'm' THEN 'M'
    WHEN 'l' THEN 'L'
    WHEN 'xl' THEN 'XL'
    WHEN '5xl' THEN '5XL'
    ELSE TRIM(raw)
  END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_size_rank(val text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(TRIM(COALESCE(val, '')))
    WHEN 'ONE SIZE' THEN 1
    WHEN '3XS' THEN 10
    WHEN 'XXS' THEN 20
    WHEN 'XS' THEN 30
    WHEN 'S' THEN 40
    WHEN 'M' THEN 50
    WHEN 'L' THEN 60
    WHEN 'XL' THEN 70
    WHEN '2XL' THEN 80
    WHEN '3XL' THEN 90
    WHEN '4XL' THEN 100
    WHEN '5XL' THEN 110
    ELSE 999
  END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_product_sizes(raw_sizes text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized_tokens AS (
    SELECT DISTINCT
      public.canonicalize_size_token(s) AS token
    FROM unnest(raw_sizes) AS s
    WHERE s IS NOT NULL AND TRIM(s) <> ''
  )
  SELECT COALESCE(
    array_agg(
      token
      ORDER BY
        public.canonicalize_size_rank(token) ASC,
        CASE WHEN token ~ '^[0-9]+(\.[0-9]+)?$' THEN 0 ELSE 1 END ASC,
        CASE WHEN token ~ '^[0-9]+(\.[0-9]+)?$' THEN (token)::numeric ELSE NULL END ASC NULLS LAST,
        token ASC
    ),
    ARRAY[]::text[]
  )
  FROM normalized_tokens;
$$;

-- Perform idempotent update on products table
UPDATE public.products
SET
  sizes = public.canonicalize_product_sizes(sizes),
  updated_at = NOW()
WHERE sizes IS NOT NULL
  AND cardinality(sizes) > 0
  AND sizes IS DISTINCT FROM public.canonicalize_product_sizes(sizes);
