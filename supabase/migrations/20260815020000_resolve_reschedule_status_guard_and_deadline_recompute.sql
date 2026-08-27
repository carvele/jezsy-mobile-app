-- Fixes two real bugs in resolve_reschedule(), found while investigating
-- what happens to a reservation whose payment deadline lapses:
--
-- 1. No status guard. Approving/declining a reschedule request never
--    checked the reservation's own status. If the payment deadline lapses
--    (expire_unpaid_reservations() sets status='Cancelled') while a
--    customer's reschedule request from before the cancel is still
--    unresolved, staff could call resolve_reschedule(..., true) and it
--    would silently move date/appointment_time on the cancelled row and
--    clear the reschedule_requested_* columns -- making a dead reservation
--    look freshly rescheduled without actually reviving it. Same risk for
--    'Completed' rows.
--
-- 2. payment_due_at never recomputed. On approval this writes the new
--    date/appointment_time directly via UPDATE, not through a status
--    transition, so set_payment_due_on_confirm()'s trigger (which only
--    fires when status moves INTO the awaiting-payment bucket) never runs.
--    A reservation moved to an EARLIER slot keeps its old, farther-out
--    deadline -- the customer can hold it unpaid right through the new,
--    closer pickup. A reservation moved to a LATER slot keeps its old,
--    closer deadline -- expire_unpaid_reservations() can auto-cancel it
--    while it still has plenty of runway before the real new appointment.
--    owner-dashboard's src/utils/reservationDeadline.js already computes
--    this correctly for its own separate direct-write reschedule modal;
--    this RPC (the customer-request/staff-approve path) never had the
--    equivalent fix.
--
-- No live reservations are currently affected by either bug (checked
-- directly against the live table before writing this).

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
  v_new_due_at timestamptz;
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

  IF lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot resolve a reschedule request on a % reservation.', v_res.status;
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending reschedule request for this reservation.';
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

    -- Recompute the payment deadline against the *new* appointment time.
    -- Only touches reservations still actually awaiting payment; paid/
    -- submitted ones are left alone. Overwrites (not COALESCE like the
    -- trigger) because the whole point here is the old value is stale.
    v_new_due_at := NULL;
    IF public.is_awaiting_payment_status(v_res.status)
       AND lower(coalesce(v_res.payment_status, '')) NOT IN ('paid', 'submitted') THEN
      v_new_due_at := least(
        now() + interval '24 hours',
        v_res.reschedule_requested_at_time - interval '1 hour'
      );
    END IF;

    UPDATE public.reservations
    SET date                         = v_res.reschedule_requested_date,
        appointment_time             = v_res.reschedule_requested_at_time,
        payment_due_at               = COALESCE(v_new_due_at, payment_due_at),
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
