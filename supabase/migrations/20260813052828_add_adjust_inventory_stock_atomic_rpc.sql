-- Adds an atomic stock-delta RPC to close a real race condition found across
-- 3 call sites in owner-dashboard: handleRestock and recordBoutiqueSale in
-- Inventory.jsx/productService.js, and adjustInventoryForReservation in
-- reservationService.js (used by every reservation lifecycle action).
--
-- All three did the same non-atomic read-then-write: SELECT the current
-- total/available/reserved into a JS variable (or use a stale value already
-- sitting in component state), compute the new absolute value in JS, then
-- UPDATE with that computed value. Two concurrent calls against the same
-- inventory row (a double-click before the button disables, two staff
-- acting near-simultaneously, or a realtime refresh racing a manual click)
-- both read the same starting values, and whichever UPDATE lands second
-- silently overwrites the first's result -- one of the two deltas is lost
-- with no error.
--
-- adjust_inventory_stock takes deltas, not absolute values, and applies them
-- in a single UPDATE statement inside a FOR UPDATE-locked transaction, so
-- Postgres serializes concurrent callers against the row's live value
-- instead of a JS-side snapshot. SECURITY INVOKER: inventory's own RLS
-- ("Enable all access for owner/staff", using is_staff_or_admin()) already
-- gates writes correctly, so this respects it directly rather than needing
-- DEFINER privilege escalation.

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_inventory_id uuid,
  p_total_delta integer DEFAULT 0,
  p_available_delta integer DEFAULT 0,
  p_reserved_delta integer DEFAULT 0
)
RETURNS TABLE (
  prev_total integer,
  prev_available integer,
  prev_reserved integer,
  new_total integer,
  new_available integer,
  new_reserved integer,
  out_product_doc_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before public.inventory%rowtype;
  v_after public.inventory%rowtype;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Staff access required.';
  END IF;

  SELECT * INTO v_before FROM public.inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory row % not found.', p_inventory_id;
  END IF;

  UPDATE public.inventory
  SET total = GREATEST(0, total + p_total_delta),
      available = GREATEST(0, available + p_available_delta),
      reserved = GREATEST(0, reserved + p_reserved_delta),
      updated_at = now()
  WHERE id = p_inventory_id
  RETURNING * INTO v_after;

  RETURN QUERY SELECT v_before.total, v_before.available, v_before.reserved,
                      v_after.total, v_after.available, v_after.reserved,
                      v_after.product_doc_id;
END;
$function$;
