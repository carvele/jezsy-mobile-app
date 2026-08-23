-- ============================================================================
-- Migration: Add color, pattern, and variant_sku columns to inventory
-- ============================================================================

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS color       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pattern     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_sku text;

COMMENT ON COLUMN public.inventory.color IS
  'Stock-tracked colourway. Empty string = product does not vary by colour.';
COMMENT ON COLUMN public.inventory.pattern IS
  'Stock-tracked pattern. Empty string = product does not vary by pattern.';
COMMENT ON COLUMN public.inventory.variant_sku IS
  'Human-readable per-variant SKU, e.g. GOWN01-RED-SOLID-M. Display/scanning aid.';

-- Backfill from products.base_color and products.pattern where available
UPDATE public.inventory AS i
SET color   = COALESCE(NULLIF(TRIM(p.base_color), ''), ''),
    pattern = COALESCE(NULLIF(TRIM(p.pattern), ''), 'Solid')
FROM public.products AS p
WHERE i.product_doc_id = p.id
  AND i.color = ''
  AND i.pattern = '';

-- Backfill variant_sku where possible
UPDATE public.inventory
SET variant_sku = UPPER(
      CONCAT_WS('-',
        NULLIF(TRIM(sku), ''),
        NULLIF(REGEXP_REPLACE(color,   '[^A-Za-z0-9]+', '', 'g'), ''),
        NULLIF(REGEXP_REPLACE(pattern, '[^A-Za-z0-9]+', '', 'g'), ''),
        NULLIF(REGEXP_REPLACE(size,    '[^A-Za-z0-9]+', '', 'g'), '')
      )
    )
WHERE variant_sku IS NULL
  AND COALESCE(TRIM(sku), '') <> '';

-- Drop old (product_doc_id, size) unique constraint if present
DO $$
DECLARE
  old_constraint text;
BEGIN
  SELECT con.conname INTO old_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'inventory'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ) = ARRAY['product_doc_id', 'size']::text[];

  IF old_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inventory DROP CONSTRAINT %I', old_constraint);
  END IF;
END $$;

-- Drop old bare index if present
DO $$
DECLARE
  old_index text;
BEGIN
  SELECT ic.relname INTO old_index
  FROM pg_index idx
  JOIN pg_class rel ON rel.oid = idx.indrelid
  JOIN pg_class ic ON ic.oid = idx.indexrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'inventory'
    AND idx.indisunique
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c WHERE c.conindid = idx.indexrelid
    )
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(idx.indkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = k.attnum
    ) = ARRAY['product_doc_id', 'size']::text[];

  IF old_index IS NOT NULL THEN
    EXECUTE format('DROP INDEX public.%I', old_index);
  END IF;
END $$;

-- Create composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS inventory_variant_unique
  ON public.inventory (product_doc_id, size, color, pattern)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS inventory_product_variant_lookup
  ON public.inventory (product_doc_id, deleted);
