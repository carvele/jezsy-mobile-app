ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_product_size_key UNIQUE (product_doc_id, size);

ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_nonnegative_check
  CHECK (total >= 0 AND reserved >= 0 AND reserved <= total);

CREATE INDEX IF NOT EXISTS idx_inventory_product_doc_id ON public.inventory (product_doc_id);
