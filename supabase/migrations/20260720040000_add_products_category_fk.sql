-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- Exists live (ledger version 20260720040000, name add_products_category_fk)
-- with no file in this repo. Reconstructed exactly from the live constraint
-- definition (high confidence -- FK shape is unambiguous):
--   products_category_id_fkey: FOREIGN KEY (category_id)
--     REFERENCES categories(id) ON DELETE SET NULL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass AND conname = 'products_category_id_fkey'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
END $$;
