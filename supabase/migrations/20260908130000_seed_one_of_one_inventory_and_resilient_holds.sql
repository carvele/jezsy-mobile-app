-- ============================================================================
-- Migration: Seed 1-of-1 products into inventory & backfill zero-inventory products
--
-- Objective:
-- 1. Ensure 1-of-1 products (with NULL or empty sizes array) automatically get
--    one active inventory row ('One Size') so variant lookups and reservations
--    never fail with P0001 "Selected size and color do not identify one active inventory variant".
-- 2. Backfill existing active catalog products that currently have 0 active inventory rows.
-- ============================================================================

-- 1. Updated trigger function
CREATE OR REPLACE FUNCTION public.seed_inventory_for_new_product()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sz text;
  prod_color text;
  clean_code text;
  clean_color text;
  v_sku text;
  effective_sizes text[];
BEGIN
  prod_color := COALESCE(NULLIF(TRIM(NEW.color), ''), NULLIF(TRIM(NEW.base_color), ''), '');

  -- Determine effective sizes: if sizes is empty or null (1-of-1 product), use 'One Size'
  IF NEW.sizes IS NULL OR array_length(NEW.sizes, 1) IS NULL OR array_length(NEW.sizes, 1) = 0 THEN
    effective_sizes := ARRAY['One Size']::text[];
  ELSE
    effective_sizes := NEW.sizes;
  END IF;

  -- One inventory row per declared / effective size (skip if already exists)
  FOREACH sz IN ARRAY effective_sizes LOOP
    IF NEW.style_code IS NOT NULL AND TRIM(NEW.style_code) != '' THEN
      clean_code := UPPER(TRIM(NEW.style_code));
      IF prod_color != '' THEN
        clean_color := UPPER(REGEXP_REPLACE(prod_color, '[^A-Za-z0-9]+', '', 'g'));
        v_sku := clean_code || '-' || clean_color || '-' || UPPER(TRIM(sz));
      ELSE
        v_sku := clean_code || '-' || UPPER(TRIM(sz));
      END IF;
    ELSE
      v_sku := NULL;
    END IF;

    INSERT INTO public.inventory (
      product_doc_id, item, category, size, color, pattern,
      sku, variant_sku,
      total, reserved, available, deleted, created_at, updated_at
    )
    SELECT
      NEW.id, NEW.name, NEW.category, sz, prod_color, '',
      NEW.style_code, v_sku,
      1, 0, 1, false, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.product_doc_id = NEW.id AND (i.size IS NOT DISTINCT FROM sz OR (i.size IS NULL AND sz = 'One Size'))
        AND (i.color IS NOT DISTINCT FROM prod_color OR (i.color IS NULL AND prod_color = ''))
        AND (i.deleted IS NULL OR i.deleted = false)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- 2. Backfill: Insert 1 inventory row for any active product with 0 inventory rows
INSERT INTO public.inventory (
  product_doc_id,
  item,
  category,
  size,
  color,
  pattern,
  sku,
  variant_sku,
  total,
  reserved,
  available,
  deleted,
  created_at,
  updated_at
)
SELECT
  p.id AS product_doc_id,
  p.name AS item,
  p.category AS category,
  COALESCE((p.sizes)[1], 'One Size') AS size,
  COALESCE(NULLIF(TRIM(p.color), ''), NULLIF(TRIM(p.base_color), ''), '') AS color,
  '',
  p.style_code AS sku,
  CASE
    WHEN p.style_code IS NOT NULL AND TRIM(p.style_code) != '' THEN
      UPPER(TRIM(p.style_code)) || '-' || UPPER(TRIM(COALESCE((p.sizes)[1], 'OS')))
    ELSE NULL
  END AS variant_sku,
  1 AS total,
  0 AS reserved,
  1 AS available,
  false AS deleted,
  now() AS created_at,
  now() AS updated_at
FROM public.products p
WHERE COALESCE(p.deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory i
    WHERE i.product_doc_id = p.id
      AND (i.deleted IS NULL OR i.deleted = false)
  );
