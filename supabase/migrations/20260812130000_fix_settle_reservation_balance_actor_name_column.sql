-- Fixes a second bug in settle_reservation_balance(), found while writing a
-- rolled-back verification test for 20260812120000's fix: it selected
-- profiles.full_name, a column that has never existed (profiles has
-- first_name/last_name, per every other RPC's own naming pattern -- see
-- create_reservation_rpc, appointment_time_timestamptz, etc.).
--
-- This predates 20260812120000 (already present in
-- 20260809190000_audit_remediation_pack.sql) but is fixed here since
-- 20260812120000 re-shipped the same line unnoticed. Verified fixed via a
-- rolled-back live test: insert a paid test reservation, call the RPC as an
-- impersonated staff actor, confirm all four balance_settled_* columns are
-- written, then ROLLBACK.
CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res record;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  IF lower(COALESCE(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The deposit has not been paid yet.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = COALESCE(v_actor_name, 'Staff'),
      balance_settled_method = _method
  WHERE id = _reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_reservation_balance(uuid, text) TO authenticated;
