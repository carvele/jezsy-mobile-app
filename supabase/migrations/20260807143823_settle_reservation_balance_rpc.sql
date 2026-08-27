-- Records that the outstanding balance was collected in person.
--
-- SECURITY DEFINER with its own guards, matching create_order rather than
-- create_reservation: this is a trusted staff write path, and the table's
-- UPDATE policy is owner-only, so an INVOKER function would fail closed for
-- anyone who is not already an owner -- the exact trap create_reservation fell
-- into and which CLAUDE.md records.
CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_res public.reservations%rowtype;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('staff', 'owner') THEN
    RAISE EXCEPTION 'Only staff can record a balance.';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This balance has already been recorded.';
  END IF;

  -- Nothing is owed until the deposit itself has cleared; before that the whole
  -- price is outstanding and the payment deadline owns chasing it.
  IF lower(COALESCE(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The deposit has not been paid yet.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'This reservation was paid in full; there is no balance.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_method     = _method,
      balance_settled_by = v_actor
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN to_jsonb(v_res);
END;
$function$;

-- REVOKE FROM anon alone can no-op because of the PUBLIC default grant, so
-- revoke PUBLIC first and verify with has_function_privilege afterwards.
REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_reservation_balance(uuid, text) TO authenticated;
