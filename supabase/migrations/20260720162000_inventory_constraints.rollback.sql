DROP INDEX IF EXISTS public.idx_inventory_product_doc_id;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_nonnegative_check;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_product_size_key;
