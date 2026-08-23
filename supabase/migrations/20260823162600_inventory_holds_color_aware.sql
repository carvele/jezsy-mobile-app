-- ============================================================================
-- Migration: Make reservation inventory holds and releases color-aware
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hold_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_deleted boolean;
  v_available integer;
  v_product_name text;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
    INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = NEW.reservation_id;

  IF NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN NEW;
  END IF;

  SELECT i.available INTO v_available
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND i.size IS NOT DISTINCT FROM NEW.size
    AND i.color IS NOT DISTINCT FROM COALESCE(NEW.color, '')
    AND i.deleted = false
  FOR UPDATE;

  -- Untracked variant fallback
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_available < NEW.quantity THEN
    SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
    RAISE EXCEPTION 'Only % left of % (size %, color %).',
      v_available,
      coalesce(v_product_name, 'this item'),
      coalesce(NEW.size, 'one size'),
      coalesce(NEW.color, 'default')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory
  SET available = available - NEW.quantity,
      reserved  = coalesce(reserved, 0) + NEW.quantity
  WHERE product_doc_id = NEW.product_id
    AND size IS NOT DISTINCT FROM NEW.size
    AND color IS NOT DISTINCT FROM COALESCE(NEW.color, '')
    AND deleted = false;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_on_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was boolean;
  v_now boolean;
  v_short record;
BEGIN
  v_was := public.reservation_holds_stock(OLD.status, OLD.deleted);
  v_now := public.reservation_holds_stock(NEW.status, NEW.deleted);

  IF v_was = v_now THEN
    RETURN NEW;
  END IF;

  IF v_was AND NOT v_now THEN
    IF lower(coalesce(NEW.status, '')) = 'completed' AND NOT coalesce(NEW.deleted, false) THEN
      -- Picked up: unit physically leaves boutique
      UPDATE public.inventory i
      SET reserved = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          total    = GREATEST(coalesce(i.total, 0) - ri.quantity, 0)
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.color IS NOT DISTINCT FROM COALESCE(ri.color, '')
        AND i.deleted = false;
    ELSE
      -- Cancelled or soft-deleted: hold returns to available
      UPDATE public.inventory i
      SET reserved  = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          available = coalesce(i.available, 0) + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.color IS NOT DISTINCT FROM COALESCE(ri.color, '')
        AND i.deleted = false;
    END IF;
  ELSE
    IF lower(coalesce(OLD.status, '')) = 'completed' THEN
      RAISE EXCEPTION 'A completed pickup cannot be reopened; adjust inventory manually instead.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT ri.size AS size, ri.color AS color, i.available AS available
      INTO v_short
    FROM public.reservation_items ri
    JOIN public.inventory i
      ON i.product_doc_id = ri.product_id
     AND i.size IS NOT DISTINCT FROM ri.size
     AND i.color IS NOT DISTINCT FROM COALESCE(ri.color, '')
     AND i.deleted = false
    WHERE ri.reservation_id = NEW.id
      AND i.available < ri.quantity
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Cannot reactivate this reservation: only % left of size % (color %).',
        v_short.available, coalesce(v_short.size, 'one size'), coalesce(v_short.color, 'default')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.inventory i
    SET available = coalesce(i.available, 0) - ri.quantity,
        reserved  = coalesce(i.reserved, 0) + ri.quantity
    FROM public.reservation_items ri
    WHERE ri.reservation_id = NEW.id
      AND i.product_doc_id = ri.product_id
      AND i.size IS NOT DISTINCT FROM ri.size
      AND i.color IS NOT DISTINCT FROM COALESCE(ri.color, '')
      AND i.deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_deleted boolean;
  v_item_color text;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
    INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = OLD.reservation_id;

  IF NOT FOUND OR NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN OLD;
  END IF;

  UPDATE public.inventory
  SET reserved  = GREATEST(coalesce(reserved, 0) - OLD.quantity, 0),
      available = coalesce(available, 0) + OLD.quantity
  WHERE product_doc_id = OLD.product_id
    AND size IS NOT DISTINCT FROM OLD.size
    AND color IS NOT DISTINCT FROM COALESCE(OLD.color, '')
    AND deleted = false;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hold_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_inventory_on_reservation_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
