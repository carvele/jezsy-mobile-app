-- =============================================================================
-- Hotfix: Insert missing mark_unclaimed_reservation and redefine old handover overload
-- =============================================================================

-- Redefine the old single-argument overload to delegate to the canonical implementation
-- This preserves backwards compatibility while supporting 'Unclaimed'
CREATE OR REPLACE FUNCTION public.complete_reservation_handover(
  _reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public.complete_reservation_handover(_reservation_id, 'cash');
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_reservation_handover(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_reservation_handover(uuid) TO authenticated;

-- Create the missing mark_unclaimed_reservation RPC
CREATE OR REPLACE FUNCTION public.mark_unclaimed_reservation(
  _reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_res              public.reservations%rowtype;
  v_total_paid       bigint := 0;
BEGIN
  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Only Ready reservations can be marked Unclaimed.' USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(v_res.extension_status, '') = 'pending' THEN
    RAISE EXCEPTION 'Cannot auto-cancel or mark unclaimed while a pickup extension request is pending.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_res.pickup_deadline_at IS NULL OR v_res.pickup_deadline_at >= now() THEN
    RAISE EXCEPTION 'Pickup deadline has not expired.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  IF v_total_paid < round(coalesce(v_res.rental_price, 0) * 100)::bigint THEN
    RAISE EXCEPTION 'Only fully paid reservations can become Unclaimed.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.reservations
  SET status              = 'Unclaimed',
      countdown           = false,
      updated_at          = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, action, target_type, target_id, details)
  VALUES (
    NULL, 'pickup_overdue_unclaimed', 'reservation', _reservation_id::text,
    jsonb_build_object('display_id', v_res.display_id, 'pickup_deadline_at', v_res.pickup_deadline_at)
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id, 'status', 'Unclaimed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_unclaimed_reservation(uuid) FROM PUBLIC, anon, authenticated;
