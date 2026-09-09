UPDATE public.inventory dup
SET deleted = true,
    deleted_at = now(),
    updated_at = now()
WHERE dup.deleted = false
  AND dup.pattern = ''
  AND dup.sku = ''
  AND dup.total = 0
  AND EXISTS (
    SELECT 1 FROM public.inventory keeper
    WHERE keeper.id <> dup.id
      AND keeper.product_doc_id = dup.product_doc_id
      AND keeper.size = dup.size
      AND keeper.color = dup.color
      AND keeper.deleted = false
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique_active_variant
ON public.inventory (product_doc_id, size, color)
WHERE deleted = false;
