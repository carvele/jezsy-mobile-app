-- Rollback for 20260815020000_resolve_reschedule_status_guard_and_deadline_recompute.sql.
-- Restores resolve_reschedule() to the 20260813120000 version: no status
-- guard (can "resolve" a request on an already-cancelled/completed
-- reservation) and no payment_due_at recompute on approval (stale deadline
-- after reschedule). Only use this to revert to that known-buggy state,
-- not as a template.

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
  v_res public.reservations%rowtype;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can resolve a reschedule request.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending reschedule request for this reservation.';
  END IF;

  IF _approve THEN
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

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'approved', _approve
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_reschedule(uuid, boolean) TO authenticated;
