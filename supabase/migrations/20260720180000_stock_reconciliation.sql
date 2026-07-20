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
