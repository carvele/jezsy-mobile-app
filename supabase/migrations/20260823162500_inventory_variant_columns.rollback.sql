-- Rollback: Remove inventory variant columns and restore (product_doc_id, size) index

DROP INDEX IF EXISTS public.inventory_variant_unique;
DROP INDEX IF EXISTS public.inventory_product_variant_lookup;

ALTER TABLE public.inventory
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS pattern,
  DROP COLUMN IF EXISTS variant_sku;

ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_product_doc_id_size_key
  UNIQUE (product_doc_id, size);
