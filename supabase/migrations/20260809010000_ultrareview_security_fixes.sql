-- Migration: 20260809010000_ultrareview_security_fixes.sql
-- Description: Phase 1 Security & Data Integrity fixes (C-2, H-8, M-8)

-- 1. C-2: Pin search_path on prevent_stock_movement_updates function
-- Standard: OWASP A05:2021 Security Misconfiguration / PostgreSQL Security Best Practices
CREATE OR REPLACE FUNCTION public.prevent_stock_movement_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Stock movements are immutable — cannot UPDATE records';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Stock movements are immutable — cannot DELETE records';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 2. H-8: Add FOR UPDATE lock to reactivation inventory check in apply_inventory_on_reservation_status_change
-- Prevents TOCTOU race conditions allowing double-booking on reservation reactivation
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

  -- UPDATE OF fires whenever the column is in the SET list, value changed or not
  IF v_was = v_now THEN
    RETURN NEW;
  END IF;

  IF v_was AND NOT v_now THEN
    IF lower(coalesce(NEW.status, '')) = 'completed' AND NOT coalesce(NEW.deleted, false) THEN
      UPDATE public.inventory i
      SET reserved = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          total    = GREATEST(coalesce(i.total, 0) - ri.quantity, 0)
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.deleted = false;
    ELSE
      UPDATE public.inventory i
      SET reserved  = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          available = coalesce(i.available, 0) + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.deleted = false;
    END IF;
  ELSE
    IF lower(coalesce(OLD.status, '')) = 'completed' THEN
      RAISE EXCEPTION 'A completed pickup cannot be reopened; adjust inventory manually instead.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Added FOR UPDATE OF i to lock inventory row and prevent concurrent reactivation race condition
    SELECT ri.size AS size, i.available AS available
      INTO v_short
    FROM public.reservation_items ri
    JOIN public.inventory i
      ON i.product_doc_id = ri.product_id
     AND i.size IS NOT DISTINCT FROM ri.size
     AND i.deleted = false
    WHERE ri.reservation_id = NEW.id
      AND i.available < ri.quantity
    LIMIT 1
    FOR UPDATE OF i;

    IF FOUND THEN
      RAISE EXCEPTION 'Cannot reactivate this reservation: only % left of size %.',
        v_short.available, coalesce(v_short.size, 'one size')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.inventory i
    SET available = coalesce(i.available, 0) - ri.quantity,
        reserved  = coalesce(i.reserved, 0) + ri.quantity
    FROM public.reservation_items ri
    WHERE ri.reservation_id = NEW.id
      AND i.product_doc_id = ri.product_id
      AND i.size IS NOT DISTINCT FROM ri.size
      AND i.deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. M-8: Explicitly revoke EXECUTE permissions on set_review_verified_purchase
-- Enforces principle of least privilege per lock_rpc_execution.sql posture
REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM authenticated;
