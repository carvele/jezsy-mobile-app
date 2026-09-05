-- recalculate_inventory_stock() joined reservations.product_id (uuid) directly
-- against inventory.sku (text) with no cast, which Postgres has no equality
-- operator for -- every manual sync in the admin dashboard failed with
-- "operator does not exist: uuid = text". Cast the uuid side to text so the
-- comparison actually runs (sku is a plain business code, never itself a
-- valid uuid, so casting sku the other way would break instead of just being
-- a no-op).
CREATE OR REPLACE FUNCTION public.recalculate_inventory_stock()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inventory_count integer;
  v_product_count integer;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'staff role required';
  END IF;

  WITH calculated AS (
    SELECT i.id,
           COALESCE(SUM(r.quantity), 0)::integer AS reserved
    FROM public.inventory i
    LEFT JOIN public.reservations r
      ON r.size = i.size
     AND (r.product_id = i.product_doc_id OR r.product_id::text = i.sku OR r.product_name = i.item)
     AND r.status IN ('Approved', 'Confirmed', 'To Pay', 'Preparing', 'To Pickup', 'Fitting', 'Active', 'Ready')
    WHERE COALESCE(i.deleted, false) = false
    GROUP BY i.id
  ), updated AS (
    UPDATE public.inventory i
       SET reserved = c.reserved,
           available = GREATEST(0, COALESCE(i.total, 0) - c.reserved),
           updated_at = now()
      FROM calculated c
     WHERE i.id = c.id
    RETURNING i.id
  )
  SELECT count(*) INTO v_inventory_count FROM updated;

  WITH totals AS (
    SELECT i.product_doc_id,
           COALESCE(SUM(i.available), 0)::integer AS available,
           COALESCE(SUM(i.reserved), 0)::integer AS reserved
      FROM public.inventory i
     WHERE COALESCE(i.deleted, false) = false
       AND i.product_doc_id IS NOT NULL
     GROUP BY i.product_doc_id
  ), updated AS (
    UPDATE public.products p
       SET stock = t.available,
           status = CASE WHEN t.available <= 0 THEN CASE WHEN t.reserved > 0 THEN 'Reserved' ELSE 'Out of Stock' END ELSE 'In Boutique' END,
           updated_at = now()
      FROM totals t
     WHERE p.id = t.product_doc_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_product_count FROM updated;

  RETURN jsonb_build_object('inventory_rows', v_inventory_count, 'products', v_product_count);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_inventory_stock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_stock() TO authenticated;
