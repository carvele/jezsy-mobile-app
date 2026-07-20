-- Migration: Derive products.stock/status from inventory via trigger
--
-- DB_TABLE_AUDIT_2026-07-20.md found products.stock and inventory as two
-- unlinked sources of truth, with a live hit: "White Dress" had
-- products.stock=32 while its inventory rows summed to 40.
--
-- admin-dashboard's productService.js already has a client-side function,
-- syncProductStock(), whose own comment says it exists as "the
-- Supabase-side replacement for the Firebase Cloud Function
-- (functions/src/triggers/syncInventory.ts) which never runs here" -- i.e.
-- the intended design was always a server-side trigger; a client-side
-- approximation was substituted because Supabase migration never added one.
-- Every inventory mutation that skips the client helper (or fails partway,
-- or races with a concurrent write) silently drifts products.stock, which
-- is exactly what happened to White Dress.
--
-- This migration ports that logic into an actual Postgres trigger, matching
-- syncProductStock's own formula exactly (stock = sum(available), status
-- derived from available/reserved), so it can no longer drift regardless of
-- which client mutates inventory. The client-side syncProductStock becomes
-- redundant but harmless (it will just write the same values the trigger
-- already computed); removing it from admin-dashboard is a follow-up in
-- that repo, not done here.
--
-- Also extends stock_movements.change_type to allow 'sale' and
-- 'reservation', since neither admin's walk-in-sale path nor the mobile
-- reservation flow currently logs a movement row -- the ledger could never
-- explain all stock changes. Logging those movements is left as a
-- DB_IMPLEMENTATION_PLAN.md Batch 4 code change (in both apps); this
-- migration only makes the value a valid one to log.

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_change_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_change_type_check
  CHECK (change_type = ANY (ARRAY['manual_adjustment', 'restock', 'correction', 'sale', 'reservation']));

CREATE OR REPLACE FUNCTION public.sync_product_stock(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_available integer;
  v_reserved integer;
  v_status text;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    coalesce(sum(available), 0),
    coalesce(sum(reserved), 0)
  INTO v_available, v_reserved
  FROM public.inventory
  WHERE product_doc_id = p_product_id
    AND deleted = false;

  IF v_available <= 0 THEN
    v_status := CASE WHEN v_reserved > 0 THEN 'Reserved' ELSE 'Out of Stock' END;
  ELSE
    v_status := 'In Boutique';
  END IF;

  UPDATE public.products
  SET stock = v_available,
      status = v_status,
      updated_at = now()
  WHERE id = p_product_id
    AND (stock IS DISTINCT FROM v_available OR status IS DISTINCT FROM v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_product_stock_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_product_stock(OLD.product_doc_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_product_stock(NEW.product_doc_id);
  IF TG_OP = 'UPDATE' AND OLD.product_doc_id IS DISTINCT FROM NEW.product_doc_id THEN
    PERFORM public.sync_product_stock(OLD.product_doc_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_stock_from_inventory ON public.inventory;
CREATE TRIGGER trg_sync_product_stock_from_inventory
AFTER INSERT OR UPDATE OR DELETE ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_product_stock_from_inventory();

-- One-time reconciliation of all products against current inventory,
-- including the White Dress drift found by the audit. Products with no
-- inventory rows at all are left untouched (NULL product_doc_id match finds
-- nothing to sum, sync_product_stock's UPDATE ... WHERE id = p_product_id
-- with sum=0 would zero them out incorrectly if they're not inventory-
-- tracked, e.g. legacy rows) -- restrict the backfill to products that have
-- at least one inventory row.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT product_doc_id FROM public.inventory WHERE deleted = false
  LOOP
    PERFORM public.sync_product_stock(r.product_doc_id);
  END LOOP;
END $$;
