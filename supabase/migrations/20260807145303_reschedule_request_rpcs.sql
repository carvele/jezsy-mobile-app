-- Customer asks; staff decide.

CREATE OR REPLACE FUNCTION public.request_reschedule(
  _reservation_id uuid,
  _date text,
  _appointment_time text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_status text;
  v_appointment timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A new date and appointment time are required.';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id
    AND customer_id = v_user
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_status := lower(COALESCE(v_res.status, 'pending'));
  -- Matches the dashboard's CAN_RESCHEDULE_STATUSES. 'to pickup' is included
  -- here where the old RPC excluded it, which is the gap that let staff move an
  -- appointment in a state the customer could not.
  IF v_status NOT IN ('pending', 'request approval', 'confirmed', 'approved', 'to pay', 'to pickup', 'fitting') THEN
    RAISE EXCEPTION 'This reservation can no longer be rescheduled.';
  END IF;

  IF v_res.reschedule_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a reschedule request waiting for review.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  -- Fail here rather than at approval: asking for a closed day should be told
  -- to the customer immediately, not discovered by staff days later.
  PERFORM public.assert_bookable_slot(_date::date, v_appointment, _reservation_id);

  UPDATE public.reservations
  SET reschedule_requested_date    = _date::date,
      reschedule_requested_at_time = v_appointment,
      reschedule_requested_at      = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN to_jsonb(v_res);
END;
$function$;


CREATE OR REPLACE FUNCTION public.resolve_reschedule(
  _reservation_id uuid,
  _approve boolean
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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('staff', 'owner') THEN
    RAISE EXCEPTION 'Only staff can answer a reschedule request.';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'There is no reschedule request on this reservation.';
  END IF;

  IF _approve THEN
    -- The slot was free when it was asked for; it may not be now. Re-checking
    -- here is what stops an approval double-booking a slot that filled while
    -- the request sat in the queue. The row trigger re-checks again on write.
    PERFORM public.assert_bookable_slot(
      v_res.reschedule_requested_date,
      v_res.reschedule_requested_at_time,
      _reservation_id
    );

    UPDATE public.reservations
    SET date                         = v_res.reschedule_requested_date,
        appointment_time             = v_res.reschedule_requested_at_time,
        reschedule_requested_date    = NULL,
        reschedule_requested_at_time = NULL,
        reschedule_requested_at      = NULL
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  ELSE
    UPDATE public.reservations
    SET reschedule_requested_date    = NULL,
        reschedule_requested_at_time = NULL,
        reschedule_requested_at      = NULL
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  END IF;

  RETURN to_jsonb(v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_reschedule(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_reschedule(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_reschedule(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_reschedule(uuid, boolean) TO authenticated;

-- The old direct-write path is closed. It moved the booking with no approval
-- and no staff notification, which is the whole reason for the two functions
-- above. Left defined so an older build fails with a permission error rather
-- than a missing-function error.
REVOKE ALL ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM authenticated;
