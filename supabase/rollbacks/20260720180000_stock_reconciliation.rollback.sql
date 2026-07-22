-- Rollback for 20260720180000_stock_reconciliation.sql
-- Note: does not revert the one-time reconciliation backfill (products.stock
-- values corrected during that step stay corrected -- reverting to known-
-- wrong values is not a meaningful rollback).

DROP TRIGGER IF EXISTS trg_sync_product_stock_from_inventory ON public.inventory;
DROP FUNCTION IF EXISTS public.trg_sync_product_stock_from_inventory();
DROP FUNCTION IF EXISTS public.sync_product_stock(uuid);

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_change_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_change_type_check
  CHECK (change_type = ANY (ARRAY['manual_adjustment', 'restock', 'correction']));
