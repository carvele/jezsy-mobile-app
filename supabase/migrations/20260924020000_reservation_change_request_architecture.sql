-- Canonical customer change-request architecture (reschedule / ready cancellation),
-- future-only Manila slot validation, terminal pickup-extension closure, and
-- pending-request guards on lifecycle commands.
-- Legacy request_reschedule overloads, resolve_reschedule(_as_manager) and
-- cancel_reservation_after_ready stay callable until both frontends ship; a follow-up
-- migration revokes them.

-- ============================================================
-- 1. Shared helpers
-- ============================================================

-- Canonical payment window; identical formula to create_reservation_multi.
CREATE OR REPLACE FUNCTION public.compute_reservation_payment_due_at(_appointment timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_manual_max_minutes integer;
  v_due timestamptz;
BEGIN
  v_manual_max_minutes := coalesce(
    (SELECT (value->>'manual_max_minutes')::integer FROM public.settings WHERE key = 'reservationPaymentWindow'),
    120
  );
  IF _appointment IS NULL THEN
    RETURN now() + make_interval(mins => v_manual_max_minutes);
  END IF;
  v_due := LEAST(_appointment - interval '30 minutes', now() + make_interval(mins => v_manual_max_minutes));
  IF v_due < now() + interval '90 minutes' THEN
    v_due := LEAST(now() + interval '90 minutes', _appointment);
  END IF;
  RETURN v_due;
END;
$$;

-- Deterministic advisory locks on one or two Manila business dates.
CREATE OR REPLACE FUNCTION public.lock_reservation_capacity_dates(_a date, _b date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_a text := 'reservation-capacity:' || _a::text;
  v_b text := 'reservation-capacity:' || coalesce(_b, _a)::text;
BEGIN
  IF _a IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_a, v_b), 0));
  IF v_a <> v_b THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(v_a, v_b), 0));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_reservation_capacity_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_new date := (NEW.appointment_time AT TIME ZONE 'Asia/Manila')::date;
  v_old date;
BEGIN
  IF v_new IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_old := (OLD.appointment_time AT TIME ZONE 'Asia/Manila')::date;
  END IF;
  PERFORM public.lock_reservation_capacity_dates(v_new, v_old);
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Slot validation: required, Manila-date consistent, strictly future
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_bookable_slot(
  _date date,
  _appointment timestamptz,
  _exclude_reservation uuid DEFAULT NULL,
  _check_capacity boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  day_idx integer;
  standard_hours record;
  closure_record record;
  store_open time;
  store_close time;
  appt_time time;
  existing_count integer;
  day_total integer;
BEGIN
  IF _date IS NULL THEN
    RAISE EXCEPTION 'Appointment date is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF _appointment IS NULL THEN
    RAISE EXCEPTION 'Appointment time is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF (_appointment AT TIME ZONE 'Asia/Manila')::date <> _date THEN
    RAISE EXCEPTION 'Appointment time does not fall on the selected date.' USING ERRCODE = 'check_violation';
  END IF;
  IF _appointment <= now() THEN
    RAISE EXCEPTION 'The selected appointment is in the past. Choose a future date and time.'
      USING ERRCODE = 'check_violation';
  END IF;

  appt_time := (_appointment AT TIME ZONE 'Asia/Manila')::time;

  IF (EXTRACT(minute FROM appt_time)::integer % 30) <> 0
     OR EXTRACT(second FROM appt_time)::integer <> 0 THEN
    RAISE EXCEPTION 'Appointment time must be on a 30-minute boundary.' USING ERRCODE = 'check_violation';
  END IF;

  day_idx := EXTRACT(dow FROM _date);

  SELECT * INTO standard_hours FROM public.store_hours WHERE day_of_week = day_idx;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store hours are not configured for this day.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO closure_record FROM public.store_closures WHERE closure_date = _date;

  IF FOUND THEN
    IF COALESCE(closure_record.is_fully_closed, true) THEN
      RAISE EXCEPTION 'Boutique is closed on this date: %', COALESCE(closure_record.reason, 'Closed')
        USING ERRCODE = 'check_violation';
    END IF;
    store_open := COALESCE(closure_record.custom_open_time, standard_hours.open_time);
    store_close := COALESCE(closure_record.custom_close_time, standard_hours.close_time);
  ELSE
    IF COALESCE(standard_hours.is_closed, false) THEN
      RAISE EXCEPTION 'Boutique is normally closed on this day of the week.' USING ERRCODE = 'check_violation';
    END IF;
    store_open := standard_hours.open_time;
    store_close := standard_hours.close_time;
  END IF;

  IF store_open IS NULL OR store_close IS NULL OR store_open >= store_close THEN
    RAISE EXCEPTION 'Store hours are invalid for this date.' USING ERRCODE = 'check_violation';
  END IF;

  IF appt_time < store_open OR appt_time >= store_close THEN
    RAISE EXCEPTION 'Appointment time is outside of operating hours (% - %).', store_open, store_close
      USING ERRCODE = 'check_violation';
  END IF;

  IF _check_capacity THEN
    SELECT count(*) INTO existing_count
    FROM public.reservations r
    WHERE (r.appointment_time AT TIME ZONE 'Asia/Manila')::date = _date
      AND (r.appointment_time AT TIME ZONE 'Asia/Manila')::time = appt_time
      AND COALESCE(r.deleted, false) = false
      AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
      AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation);

    IF existing_count >= COALESCE(standard_hours.slot_capacity, 3) THEN
      RAISE EXCEPTION 'This time slot is fully booked. Please select another time.' USING ERRCODE = 'check_violation';
    END IF;

    IF standard_hours.max_daily_bookings IS NOT NULL THEN
      SELECT count(*) INTO day_total
      FROM public.reservations r
      WHERE (r.appointment_time AT TIME ZONE 'Asia/Manila')::date = _date
        AND COALESCE(r.deleted, false) = false
        AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
        AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation);

      IF day_total >= standard_hours.max_daily_bookings THEN
        RAISE EXCEPTION 'This date is fully booked. Please select another day.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_slot_booked_counts(_date date)
RETURNS TABLE(slot_time time without time zone, booked_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (r.appointment_time AT TIME ZONE 'Asia/Manila')::time AS slot_time,
    count(*)::integer AS booked_count
  FROM public.reservations r
  WHERE (r.appointment_time AT TIME ZONE 'Asia/Manila')::date = _date
    AND COALESCE(r.deleted, false) = false
    AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
  GROUP BY 1;
$$;

-- Trigger derives the business date from the appointment itself, not the
-- mixed-convention `date` column.
CREATE OR REPLACE FUNCTION public.validate_reservation_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.appointment_time IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.deleted, false) = true
     OR lower(COALESCE(NEW.status, 'pending')) IN ('cancelled', 'completed', 'unclaimed') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.appointment_time IS NOT DISTINCT FROM OLD.appointment_time THEN
    RETURN NEW;
  END IF;

  PERFORM public.assert_bookable_slot(
    (NEW.appointment_time AT TIME ZONE 'Asia/Manila')::date,
    NEW.appointment_time,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE NEW.id END,
    true
  );

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Pickup extension: 'closed' terminal status
-- ============================================================

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_extension_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_extension_status_check
  CHECK (extension_status IS NULL OR extension_status = ANY (ARRAY['pending', 'approved', 'denied', 'closed']));

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_extension_lifecycle;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_extension_lifecycle CHECK (
  (extension_status IS NULL AND extension_resolved_at IS NULL AND extension_resolved_by IS NULL AND extension_deadline_at IS NULL)
  OR (extension_status = 'pending' AND extension_resolved_at IS NULL AND extension_resolved_by IS NULL AND extension_deadline_at IS NULL)
  OR (extension_status = 'approved' AND extension_resolved_at IS NOT NULL AND extension_resolved_by IS NOT NULL AND extension_deadline_at IS NOT NULL)
  OR (extension_status = 'denied' AND extension_resolved_at IS NOT NULL AND extension_resolved_by IS NOT NULL AND extension_deadline_at IS NULL)
  OR (extension_status = 'closed' AND extension_requested_at IS NOT NULL AND extension_resolved_at IS NOT NULL AND extension_deadline_at IS NULL)
);

-- Closes a pending extension in the same row write that makes the reservation terminal.
CREATE OR REPLACE FUNCTION public.close_pending_extension_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_new text := lower(trim(coalesce(NEW.status, '')));
BEGIN
  IF NEW.extension_status = 'pending'
     AND v_new IN ('completed', 'cancelled', 'unclaimed')
     AND lower(trim(coalesce(OLD.status, ''))) IS DISTINCT FROM v_new THEN
    NEW.extension_status := 'closed';
    NEW.extension_resolved_at := now();
    NEW.extension_deadline_at := NULL;
    NEW.extension_resolution_notes := CASE
      WHEN v_new = 'completed' THEN 'Closed automatically because order was collected.'
      ELSE 'Closed automatically because reservation became ' || NEW.status || '.'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_pending_extension_on_terminal ON public.reservations;
CREATE TRIGGER trg_close_pending_extension_on_terminal
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.close_pending_extension_on_terminal();

-- ============================================================
-- 4. reservation_change_requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reservation_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  requested_for timestamptz NULL,
  original_for timestamptz NULL,
  reservation_status_at_request text NOT NULL,
  payment_status_at_request text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES public.profiles(id),
  resolution_notes text NULL,
  CONSTRAINT rcr_request_type_check CHECK (request_type IN ('reschedule', 'cancel_ready')),
  CONSTRAINT rcr_status_check CHECK (status IN ('pending', 'approved', 'denied', 'superseded', 'withdrawn')),
  CONSTRAINT rcr_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT rcr_resolution_notes_check CHECK (resolution_notes IS NULL OR length(resolution_notes) <= 500),
  CONSTRAINT rcr_requested_for_check CHECK (
    (request_type = 'reschedule' AND requested_for IS NOT NULL)
    OR (request_type = 'cancel_ready' AND requested_for IS NULL)
  ),
  CONSTRAINT rcr_lifecycle_check CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status IN ('approved', 'denied') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    OR (status IN ('superseded', 'withdrawn') AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS rcr_one_pending_per_reservation
  ON public.reservation_change_requests (reservation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS rcr_reservation_id_idx ON public.reservation_change_requests (reservation_id);
CREATE INDEX IF NOT EXISTS rcr_customer_id_idx ON public.reservation_change_requests (customer_id);
CREATE INDEX IF NOT EXISTS rcr_status_idx ON public.reservation_change_requests (status);
CREATE INDEX IF NOT EXISTS rcr_created_at_idx ON public.reservation_change_requests (created_at DESC);

ALTER TABLE public.reservation_change_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reservation_change_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_change_requests TO authenticated;

DROP POLICY IF EXISTS rcr_select_own ON public.reservation_change_requests;
CREATE POLICY rcr_select_own ON public.reservation_change_requests
  FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rcr_select_staff ON public.reservation_change_requests;
CREATE POLICY rcr_select_staff ON public.reservation_change_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.can_operate_reservations()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reservation_change_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_change_requests;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pending_blocking_reservation_change(_reservation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservation_change_requests
    WHERE reservation_id = _reservation_id
      AND status = 'pending'
      AND request_type IN ('reschedule', 'cancel_ready')
  );
$$;

-- A request cannot outlive its reservation's active life; expiry or staff action wins.
CREATE OR REPLACE FUNCTION public.supersede_change_requests_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new text := lower(trim(coalesce(NEW.status, '')));
BEGIN
  IF v_new IN ('completed', 'cancelled', 'unclaimed')
     AND lower(trim(coalesce(OLD.status, ''))) IS DISTINCT FROM v_new THEN
    UPDATE public.reservation_change_requests
    SET status = 'superseded',
        resolved_at = now(),
        resolution_notes = CASE
          WHEN v_new = 'unclaimed' OR NEW.cancellation_reason = 'Pickup deadline expired'
            THEN 'Superseded because pickup deadline expired.'
          ELSE 'Superseded because reservation became ' || NEW.status || '.'
        END
    WHERE reservation_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supersede_change_requests_on_terminal ON public.reservations;
CREATE TRIGGER trg_supersede_change_requests_on_terminal
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.supersede_change_requests_on_terminal();

-- Cancellation notification carries the stored reason so customers see why.
CREATE OR REPLACE FUNCTION public.notify_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text; v_body text;
  v_status text := lower(coalesce(NEW.status, ''));
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  IF v_status IN ('confirmed', 'approved', 'to pay') THEN
    IF lower(coalesce(NEW.payment_status, '')) = 'paid' THEN
      v_title := 'Reservation Confirmed';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' on ' || to_char(NEW.date, 'Mon DD, YYYY') || ' is confirmed.';
    ELSE
      v_title := 'Accepted - payment needed';
      v_body := coalesce(NEW.product_name, 'Your item') || ' has been accepted. Pay by '
                 || to_char(NEW.payment_due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, HH12:MI AM')
                 || ' to keep it.';
    END IF;
  ELSIF v_status IN ('to pickup', 'ready') THEN
    v_title := 'Ready for pickup';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is ready for pickup at your appointment.';
  ELSIF v_status = 'active' THEN
    v_title := 'Order Active';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is active.';
  ELSIF v_status = 'completed' THEN
    v_title := 'Reservation Completed';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is complete. We hope you loved it!';
  ELSIF v_status = 'cancelled' THEN
    IF lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'submitted')
       AND NEW.payment_due_at IS NOT NULL AND NEW.payment_due_at <= now() THEN
      v_title := 'Reservation Expired';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' was cancelled because payment was not received in time.';
    ELSE
      v_title := 'Reservation Cancelled';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' has been cancelled.'
                 || coalesce(' Reason: ' || nullif(trim(NEW.cancellation_reason), ''), '');
    END IF;
  ELSE
    v_title := 'Reservation Updated';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is now ' || NEW.status || '.';
  END IF;

  PERFORM public.enqueue_customer_notification(
    _user_id => NEW.customer_id,
    _title   => v_title,
    _body    => v_body,
    _type    => 'reservation',
    _data    => jsonb_build_object(
      'reservation_id', NEW.id,
      'status', NEW.status,
      'payment_status', NEW.payment_status,
      'cancellation_reason', NEW.cancellation_reason
    )
  );

  RETURN NEW;
END;
$function$;

-- Secondary request-storm protection; per actor, reservation and command.
-- Counts only committed calls (the counter row rolls back with a failed command).
CREATE OR REPLACE FUNCTION public.assert_reservation_command_rate(_command text, _reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_rate_limit(
    'reservation-op:' || coalesce(auth.uid()::text, 'system') || ':' || _reservation_id::text || ':' || _command,
    10, 60
  ) THEN
    RAISE EXCEPTION 'Too many requests for this reservation. Wait a minute and try again.'
      USING ERRCODE = 'PT429';
  END IF;
END;
$$;

-- ============================================================
-- 5. Customer commands
-- ============================================================

CREATE OR REPLACE FUNCTION public.request_reschedule_v2(
  _reservation_id uuid,
  _new_date date,
  _new_time time,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_reason text := btrim(coalesce(_reason, ''));
  v_target timestamptz;
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Please tell the boutique why you need a new time.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;
  IF _new_date IS NULL OR _new_time IS NULL THEN
    RAISE EXCEPTION 'A new date and time are required.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('to pay', 'preparing') THEN
    RAISE EXCEPTION 'This reservation can no longer be rescheduled.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_res.date IS NULL OR v_res.appointment_time IS NULL THEN
    RAISE EXCEPTION 'This reservation does not have a scheduled appointment to change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'You already have a request waiting for review.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('request_reschedule', _reservation_id);

  v_target := (_new_date + _new_time) AT TIME ZONE 'Asia/Manila';
  IF v_target = v_res.appointment_time THEN
    RAISE EXCEPTION 'Choose a different time from your current appointment.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_bookable_slot(_new_date, v_target, _reservation_id, true);

  INSERT INTO public.reservation_change_requests (
    reservation_id, customer_id, request_type, reason, requested_for, original_for,
    reservation_status_at_request, payment_status_at_request
  ) VALUES (
    _reservation_id, v_actor, 'reschedule', v_reason, v_target, v_res.appointment_time,
    v_res.status, v_res.payment_status
  ) RETURNING id INTO v_request_id;

  -- Touch the row so realtime subscribers on reservations refetch.
  UPDATE public.reservations SET updated_at = now() WHERE id = _reservation_id;

  INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id, actor_id, data, priority)
  VALUES (
    'Reschedule Request',
    coalesce(v_res.customer_name, 'A customer') || ' asked to move ' || coalesce(v_res.display_id, 'a reservation')
      || ' to ' || to_char(v_target AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM') || '.',
    'RescheduleRequest', 'reservation', _reservation_id::text, v_actor,
    jsonb_build_object('reservation_id', _reservation_id, 'request_id', v_request_id), 'high'
  );

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, v_res.customer_name, 'Customer requested reschedule', 'reservation', _reservation_id::text,
    jsonb_build_object(
      'request_id', v_request_id,
      'display_id', v_res.display_id,
      'customer_id', v_actor,
      'old_appointment', v_res.appointment_time,
      'requested_appointment', v_target,
      'reason', v_reason
    )
  );

  PERFORM public.enqueue_customer_notification(
    _user_id => v_actor,
    _title   => 'Reschedule request sent',
    _body    => 'Your request to move ' || coalesce(v_res.product_name, 'your reservation') || ' to '
                || to_char(v_target AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM')
                || ' is waiting for boutique review. Your current appointment stands until then.',
    _type    => 'reservation',
    _data    => jsonb_build_object('reservation_id', _reservation_id, 'request_id', v_request_id)
  );

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'reservation_id', _reservation_id,
    'status', 'pending',
    'requested_for', v_target
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_ready_cancellation(_reservation_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_reason text := btrim(coalesce(_reason, ''));
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Please tell the boutique why you want to cancel.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Only reservations that are Ready for Pickup can be cancelled this way.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_res.pickup_deadline_at IS NULL OR v_res.pickup_deadline_at <= now() THEN
    RAISE EXCEPTION 'The pickup deadline has passed. This reservation is handled by the expiry process.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'You already have a request waiting for review.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('request_ready_cancellation', _reservation_id);

  INSERT INTO public.reservation_change_requests (
    reservation_id, customer_id, request_type, reason, requested_for, original_for,
    reservation_status_at_request, payment_status_at_request
  ) VALUES (
    _reservation_id, v_actor, 'cancel_ready', v_reason, NULL, v_res.pickup_deadline_at,
    v_res.status, v_res.payment_status
  ) RETURNING id INTO v_request_id;

  UPDATE public.reservations SET updated_at = now() WHERE id = _reservation_id;

  INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id, actor_id, data, priority)
  VALUES (
    'Cancellation Request',
    coalesce(v_res.customer_name, 'A customer') || ' asked to cancel ready order '
      || coalesce(v_res.display_id, '') || '.',
    'CancellationRequest', 'reservation', _reservation_id::text, v_actor,
    jsonb_build_object('reservation_id', _reservation_id, 'request_id', v_request_id), 'high'
  );

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, v_res.customer_name, 'Customer requested cancellation', 'reservation', _reservation_id::text,
    jsonb_build_object(
      'request_id', v_request_id,
      'display_id', v_res.display_id,
      'customer_id', v_actor,
      'reason', v_reason,
      'payment_status', v_res.payment_status
    )
  );

  PERFORM public.enqueue_customer_notification(
    _user_id => v_actor,
    _title   => 'Cancellation requested',
    _body    => 'Your request to cancel ' || coalesce(v_res.product_name, 'your reservation')
                || ' is waiting for boutique review. Your order stays ready until then.',
    _type    => 'reservation',
    _data    => jsonb_build_object('reservation_id', _reservation_id, 'request_id', v_request_id)
  );

  RETURN jsonb_build_object('request_id', v_request_id, 'reservation_id', _reservation_id, 'status', 'pending');
END;
$$;

-- ============================================================
-- 6. Staff commands
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_reschedule_request_v2(
  _request_id uuid,
  _approve boolean,
  _resolution_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_req public.reservation_change_requests%rowtype;
  v_res public.reservations%rowtype;
  v_notes text := nullif(btrim(coalesce(_resolution_notes, '')), '');
  v_new_date date;
  v_old_date date;
  v_due timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  IF _approve IS NULL THEN
    RAISE EXCEPTION 'Choose approve or decline.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(v_notes, '')) > 500 THEN
    RAISE EXCEPTION 'Resolution note must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM public.reservation_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_req.request_type <> 'reschedule' THEN
    RAISE EXCEPTION 'Reschedule request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %.', v_req.status USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = v_req.reservation_id FOR UPDATE;

  PERFORM public.assert_reservation_command_rate('resolve_reschedule', v_req.reservation_id);

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  IF coalesce(v_res.deleted, false)
     OR lower(trim(coalesce(v_res.status, ''))) NOT IN ('to pay', 'preparing')
     OR v_res.appointment_time IS NULL THEN
    UPDATE public.reservation_change_requests
    SET status = 'superseded', resolved_at = now(), resolved_by = v_actor,
        resolution_notes = 'Superseded because reservation is now ' || coalesce(v_res.status, 'unavailable') || '.'
    WHERE id = _request_id;
    RETURN jsonb_build_object('request_id', _request_id, 'outcome', 'superseded', 'reservation_status', v_res.status);
  END IF;

  IF _approve THEN
    v_new_date := (v_req.requested_for AT TIME ZONE 'Asia/Manila')::date;
    v_old_date := (v_res.appointment_time AT TIME ZONE 'Asia/Manila')::date;
    PERFORM public.lock_reservation_capacity_dates(v_new_date, v_old_date);
    PERFORM public.assert_bookable_slot(v_new_date, v_req.requested_for, v_res.id, true);

    IF public.is_awaiting_payment_status(v_res.status)
       AND lower(coalesce(v_res.payment_status, '')) = 'pending' THEN
      v_due := public.compute_reservation_payment_due_at(v_req.requested_for);
    END IF;

    -- Resolve first so the terminal-supersede trigger never sees it pending.
    UPDATE public.reservation_change_requests
    SET status = 'approved', resolved_at = now(), resolved_by = v_actor, resolution_notes = v_notes
    WHERE id = _request_id;

    UPDATE public.reservations
    SET date = (v_new_date::text || ' 00:00:00 Asia/Manila')::timestamptz,
        appointment_time = v_req.requested_for,
        payment_due_at = coalesce(v_due, payment_due_at),
        reschedule_requested_date = NULL,
        reschedule_requested_at_time = NULL,
        reschedule_requested_at = NULL,
        updated_at = now()
    WHERE id = v_res.id
    RETURNING * INTO v_res;

    IF v_due IS NOT NULL AND v_res.payment_due_at <= now() THEN
      RAISE EXCEPTION 'Computed payment deadline is not in the future.';
    END IF;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Reschedule approved',
      _body    => 'Your appointment for ' || coalesce(v_res.product_name, 'your reservation') || ' is now '
                  || to_char(v_req.requested_for AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM') || '.'
                  || coalesce(' Note: ' || v_notes, ''),
      _type    => 'reservation',
      _data    => jsonb_build_object('reservation_id', v_res.id, 'request_id', _request_id)
    );
  ELSE
    UPDATE public.reservation_change_requests
    SET status = 'denied', resolved_at = now(), resolved_by = v_actor, resolution_notes = v_notes
    WHERE id = _request_id;

    UPDATE public.reservations SET updated_at = now() WHERE id = v_res.id;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Reschedule not approved',
      _body    => 'Your request to move ' || coalesce(v_res.product_name, 'your reservation')
                  || ' was not approved. Your appointment stays at '
                  || to_char(v_res.appointment_time AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM') || '.'
                  || coalesce(' Note: ' || v_notes, ''),
      _type    => 'reservation',
      _data    => jsonb_build_object('reservation_id', v_res.id, 'request_id', _request_id)
    );
  END IF;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, v_actor_name,
    CASE WHEN _approve THEN 'Staff approved reschedule' ELSE 'Staff declined reschedule' END,
    'reservation', v_res.id::text,
    jsonb_build_object(
      'request_id', _request_id,
      'display_id', v_res.display_id,
      'old_appointment', v_req.original_for,
      'new_appointment', CASE WHEN _approve THEN v_req.requested_for END,
      'requested_appointment', v_req.requested_for,
      'reason', v_req.reason,
      'resolution_note', v_notes
    )
  );

  RETURN jsonb_build_object(
    'request_id', _request_id,
    'outcome', CASE WHEN _approve THEN 'approved' ELSE 'denied' END,
    'reservation_id', v_res.id,
    'appointment_time', v_res.appointment_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_ready_cancellation_request(
  _request_id uuid,
  _approve boolean,
  _resolution_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_req public.reservation_change_requests%rowtype;
  v_res public.reservations%rowtype;
  v_notes text := nullif(btrim(coalesce(_resolution_notes, '')), '');
  v_total_paid bigint := 0;
  v_total_forfeited bigint := 0;
  v_payment record;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  IF _approve IS NULL THEN
    RAISE EXCEPTION 'Choose approve or decline.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(v_notes, '')) > 500 THEN
    RAISE EXCEPTION 'Resolution note must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM public.reservation_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_req.request_type <> 'cancel_ready' THEN
    RAISE EXCEPTION 'Cancellation request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %.', v_req.status USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = v_req.reservation_id FOR UPDATE;

  PERFORM public.assert_reservation_command_rate('resolve_ready_cancellation', v_req.reservation_id);

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  IF coalesce(v_res.deleted, false)
     OR lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    UPDATE public.reservation_change_requests
    SET status = 'superseded', resolved_at = now(), resolved_by = v_actor,
        resolution_notes = 'Superseded because reservation is now ' || coalesce(v_res.status, 'unavailable') || '.'
    WHERE id = _request_id;
    RETURN jsonb_build_object('request_id', _request_id, 'outcome', 'superseded', 'reservation_status', v_res.status);
  END IF;

  IF NOT _approve THEN
    UPDATE public.reservation_change_requests
    SET status = 'denied', resolved_at = now(), resolved_by = v_actor, resolution_notes = v_notes
    WHERE id = _request_id;

    UPDATE public.reservations SET updated_at = now() WHERE id = v_res.id;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Cancellation not approved',
      _body    => 'Your request to cancel ' || coalesce(v_res.product_name, 'your reservation')
                  || ' was not approved. Your order is still ready for pickup.'
                  || coalesce(' Note: ' || v_notes, ''),
      _type    => 'reservation',
      _data    => jsonb_build_object('reservation_id', v_res.id, 'request_id', _request_id)
    );

    INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
    VALUES (
      v_actor, v_actor_name, 'Staff declined cancellation', 'reservation', v_res.id::text,
      jsonb_build_object('request_id', _request_id, 'display_id', v_res.display_id,
                         'reason', v_req.reason, 'resolution_note', v_notes)
    );

    RETURN jsonb_build_object('request_id', _request_id, 'outcome', 'denied', 'reservation_id', v_res.id);
  END IF;

  -- Approved: the existing customer-fault forfeiture policy (cancel_reservation_after_ready).
  IF round(coalesce(v_res.deposit, 0) * 100)::bigint <= 0 THEN
    RAISE EXCEPTION 'Cannot determine reservation deposit amount.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = v_res.id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = v_res.id AND status = 'paid' AND refund_disbursed_at IS NULL
    ORDER BY CASE WHEN purpose IN ('initial_deposit', 'full_payment') THEN 0 ELSE 1 END, created_at
    FOR UPDATE
  LOOP
    UPDATE public.payments
    SET forfeited_centavos       = v_payment.amount_centavos,
        refund_required_centavos = NULL,
        requires_refund          = false,
        refund_required_at       = NULL,
        updated_at               = now()
    WHERE id = v_payment.id;
    v_total_forfeited := v_total_forfeited + v_payment.amount_centavos;
  END LOOP;

  IF v_total_forfeited <> v_total_paid THEN
    RAISE EXCEPTION 'Forfeiture allocation mismatch: expected % but allocated %.', v_total_paid, v_total_forfeited;
  END IF;

  UPDATE public.reservation_change_requests
  SET status = 'approved', resolved_at = now(), resolved_by = v_actor, resolution_notes = v_notes
  WHERE id = _request_id;

  -- Status triggers release inventory, close a pending extension and notify the customer.
  UPDATE public.reservations
  SET status              = 'Cancelled',
      payment_status      = 'Cancelled',
      cancellation_reason = left('Cancelled at your request: ' || v_req.reason, 500),
      countdown           = false,
      updated_at          = now()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, v_actor_name, 'Staff approved cancellation', 'reservation', v_res.id::text,
    jsonb_build_object(
      'request_id', _request_id,
      'display_id', v_res.display_id,
      'reason', v_req.reason,
      'resolution_note', v_notes,
      'total_paid_centavos', v_total_paid,
      'total_forfeited_centavos', v_total_forfeited,
      'new_payment_status', 'Cancelled'
    )
  );

  RETURN jsonb_build_object(
    'request_id', _request_id,
    'outcome', 'approved',
    'reservation_id', v_res.id,
    'status', v_res.status,
    'total_forfeited_centavos', v_total_forfeited
  );
END;
$$;

-- Manager direct reschedule: pre-Ready, reason required, blocked by customer requests.
CREATE OR REPLACE FUNCTION public.reschedule_reservation_as_manager(
  _reservation_id uuid,
  _expected_status text,
  _new_date date,
  _new_appointment_time time without time zone,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_old_appointment timestamptz;
  v_new_appointment timestamptz;
  v_reason text := btrim(coalesce(_reason, ''));
  v_due timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation operation requires staff, admin, or owner authorization.'
      USING ERRCODE = '42501';
  END IF;
  IF _new_date IS NULL OR _new_appointment_time IS NULL THEN
    RAISE EXCEPTION 'New date and time are required.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason for the customer is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(coalesce(v_res.status, ''))) <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation status has changed. Expected "%" but found "%".', _expected_status, v_res.status
      USING ERRCODE = 'PT409';
  END IF;
  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('to pay', 'preparing') THEN
    RAISE EXCEPTION 'Only reservations that are To Pay or Preparing can be rescheduled. Use pickup extension once Ready.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_res.date IS NULL OR v_res.appointment_time IS NULL THEN
    RAISE EXCEPTION 'This reservation does not have a scheduled appointment to change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'A customer change request must be reviewed first.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('manager_reschedule', _reservation_id);

  v_old_appointment := v_res.appointment_time;
  v_new_appointment := (_new_date + _new_appointment_time) AT TIME ZONE 'Asia/Manila';

  PERFORM public.lock_reservation_capacity_dates(_new_date, (v_old_appointment AT TIME ZONE 'Asia/Manila')::date);
  PERFORM public.assert_bookable_slot(_new_date, v_new_appointment, _reservation_id, true);

  IF public.is_awaiting_payment_status(v_res.status)
     AND lower(coalesce(v_res.payment_status, '')) = 'pending' THEN
    v_due := public.compute_reservation_payment_due_at(v_new_appointment);
  END IF;

  UPDATE public.reservations
  SET date = (_new_date::text || ' 00:00:00 Asia/Manila')::timestamptz,
      appointment_time = v_new_appointment,
      payment_due_at = coalesce(v_due, payment_due_at),
      reschedule_requested_date = NULL,
      reschedule_requested_at_time = NULL,
      reschedule_requested_at = NULL,
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  IF v_due IS NOT NULL AND v_res.payment_due_at <= now() THEN
    RAISE EXCEPTION 'Computed payment deadline is not in the future.';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  PERFORM public.enqueue_customer_notification(
    _user_id => v_res.customer_id,
    _title   => 'Your pickup appointment was changed',
    _body    => 'Your appointment for ' || coalesce(v_res.product_name, 'your reservation') || ' moved from '
                || to_char(v_old_appointment AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM') || ' to '
                || to_char(v_new_appointment AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM')
                || '. Reason: ' || v_reason,
    _type    => 'reservation',
    _data    => jsonb_build_object('reservation_id', _reservation_id, 'old_appointment', v_old_appointment,
                                   'new_appointment', v_new_appointment, 'reason', v_reason)
  );

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, v_actor_name, 'Staff changed appointment directly', 'reservation', _reservation_id::text,
    jsonb_build_object(
      'display_id', v_res.display_id,
      'old_appointment', v_old_appointment,
      'new_appointment', v_new_appointment,
      'reason', v_reason,
      'payment_due_at', v_res.payment_due_at
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'date', _new_date,
    'appointment_time', v_new_appointment,
    'payment_due_at', v_res.payment_due_at
  );
END;
$$;

-- Reason is required: the old default is removed, which needs a drop.
DROP FUNCTION IF EXISTS public.cancel_reservation_as_manager(uuid, text, text);
CREATE FUNCTION public.cancel_reservation_as_manager(_reservation_id uuid, _expected_status text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_next_payment_status text;
  v_reason text := btrim(coalesce(_reason, ''));
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason shown to the customer is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF lower(trim(coalesce(v_res.status, ''))) <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation changed since it was loaded. Refresh and try again.'
      USING ERRCODE = 'PT409';
  END IF;
  IF lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be cancelled.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('manager_cancel', _reservation_id);

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  IF lower(coalesce(v_res.payment_status, '')) = 'refunded' THEN
    v_next_payment_status := 'Refunded';
  ELSIF lower(coalesce(v_res.payment_status, '')) = 'refund required' THEN
    v_next_payment_status := 'Refund Required';
  ELSIF lower(coalesce(v_res.payment_status, '')) = 'paid'
     OR EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status = 'paid'
         AND p.refund_disbursed_at IS NULL
     ) THEN
    v_next_payment_status := 'Refund Required';
    UPDATE public.payments
    SET requires_refund = true,
        refund_required_at = coalesce(refund_required_at, now()),
        updated_at = now()
    WHERE reservation_id = _reservation_id
      AND status = 'paid'
      AND refund_disbursed_at IS NULL;
  ELSIF EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status IN ('awaiting_payment', 'processing')
     ) THEN
    RAISE EXCEPTION 'Payment is currently in progress. Wait for completion or expire the session before cancelling.'
      USING ERRCODE = 'check_violation';
  ELSE
    v_next_payment_status := 'Cancelled';
    IF v_res.deposit_submission_id IS NOT NULL THEN
      UPDATE public.manual_payment_submissions
      SET status = 'rejected',
          rejection_reason = 'reservation_cancelled',
          staff_note = left(v_reason, 500),
          reviewed_by = v_actor,
          reviewed_by_name = coalesce(v_actor_name, 'Staff'),
          reviewed_at = now(),
          updated_at = now()
      WHERE id = v_res.deposit_submission_id
        AND status = 'submitted';
    END IF;
  END IF;

  UPDATE public.reservations
  SET status = 'Cancelled',
      payment_status = v_next_payment_status,
      countdown = false,
      cancellation_reason = left(v_reason, 500),
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    'Cancelled reservation',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status', _expected_status,
      'payment_status', v_res.payment_status,
      'reason', v_res.cancellation_reason
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'status', v_res.status,
    'payment_status', v_res.payment_status
  );
END;
$$;

-- Server-derived financial outcome for the admin cancel confirmation.
CREATE OR REPLACE FUNCTION public.preview_reservation_cancellation(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res public.reservations%rowtype;
  v_paid bigint;
  v_outcome text;
BEGIN
  IF NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id AND coalesce(deleted, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(sum(amount_centavos), 0) INTO v_paid
  FROM public.payments
  WHERE reservation_id = _reservation_id AND status = 'paid' AND refund_disbursed_at IS NULL;

  v_outcome := CASE
    WHEN lower(coalesce(v_res.payment_status, '')) = 'refunded' THEN 'already_refunded'
    WHEN lower(coalesce(v_res.payment_status, '')) = 'refund required' THEN 'refund_already_required'
    WHEN lower(coalesce(v_res.payment_status, '')) = 'paid' OR v_paid > 0 THEN 'refund_required'
    WHEN EXISTS (SELECT 1 FROM public.payments WHERE reservation_id = _reservation_id
                 AND status IN ('awaiting_payment', 'processing')) THEN 'payment_in_progress'
    ELSE 'no_payment'
  END;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'status', v_res.status,
    'payment_status', v_res.payment_status,
    'paid_centavos', v_paid,
    'outcome', v_outcome
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reservation_status(_reservation_id uuid, _expected_status text, _next_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_actor_name    text;
  v_res           public.reservations%rowtype;
  v_old           text;
  v_next          text;
  v_stored_next   text;
  v_pickup_ready  timestamptz;
  v_pickup_dl     timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  v_old  := lower(trim(coalesce(v_res.status, '')));
  v_next := lower(trim(coalesce(_next_status, '')));

  IF v_old <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation changed since it was loaded. Refresh and try again.' USING ERRCODE = 'PT409';
  END IF;
  IF v_old IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_old IN ('pending', 'request approval') AND v_next IN ('to pay', 'confirmed') THEN
    v_stored_next := 'To Pay';
  ELSIF v_old IN ('to pay', 'confirmed', 'approved') AND v_next = 'preparing' THEN
    IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
      RAISE EXCEPTION 'Payment must be confirmed before preparation starts.' USING ERRCODE = 'check_violation';
    END IF;
    v_stored_next := 'Preparing';
  ELSIF v_old = 'preparing' AND v_next IN ('ready', 'to pickup') THEN
    IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
      RAISE EXCEPTION 'A customer change request must be reviewed first.' USING ERRCODE = 'check_violation';
    END IF;
    v_stored_next := 'Ready';
    v_pickup_ready := now();
    v_pickup_dl    := public.compute_pickup_deadline(v_pickup_ready);
  ELSE
    RAISE EXCEPTION 'Unsupported reservation transition from % to %.', v_res.status, _next_status USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('transition', _reservation_id);

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  UPDATE public.reservations
  SET status          = v_stored_next,
      confirmed_by_id   = CASE WHEN v_stored_next = 'To Pay' THEN v_actor ELSE confirmed_by_id END,
      confirmed_by_name = CASE WHEN v_stored_next = 'To Pay' THEN coalesce(v_actor_name, 'Owner') ELSE confirmed_by_name END,
      confirmed_at      = CASE WHEN v_stored_next = 'To Pay' THEN now() ELSE confirmed_at END,
      assigned_staff_id = CASE WHEN v_stored_next = 'Preparing' THEN v_actor ELSE assigned_staff_id END,
      countdown         = CASE WHEN v_stored_next = 'Preparing' THEN false ELSE countdown END,
      pickup_ready_at   = CASE WHEN v_stored_next = 'Ready' THEN v_pickup_ready ELSE pickup_ready_at END,
      pickup_deadline_at = CASE WHEN v_stored_next = 'Ready' THEN v_pickup_dl ELSE pickup_deadline_at END,
      updated_at        = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    CASE v_stored_next
      WHEN 'Preparing' THEN 'Started preparing reservation'
      WHEN 'Ready' THEN 'Marked reservation ready for pickup'
      ELSE 'Changed reservation status'
    END,
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status',   _expected_status,
      'new_status',        v_stored_next,
      'pickup_ready_at',   v_res.pickup_ready_at,
      'pickup_deadline_at', v_res.pickup_deadline_at
    )
  );

  RETURN jsonb_build_object(
    'reservation_id',    _reservation_id,
    'status',            v_res.status,
    'pickup_ready_at',   v_res.pickup_ready_at,
    'pickup_deadline_at', v_res.pickup_deadline_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_reservation_handover(_reservation_id uuid, _method text DEFAULT 'cash')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_outstanding numeric;
  v_previous_status text;
  v_extension_closed boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found or deleted.'; END IF;

  IF lower(coalesce(v_res.status, '')) NOT IN ('ready', 'to pickup', 'fitting', 'unclaimed') THEN
    RAISE EXCEPTION 'Only an item ready for pickup or unclaimed can be handed over.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'A customer change request must be reviewed first.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before handover.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_outstanding := coalesce(v_res.rental_price, 0) - coalesce(v_res.deposit, 0);
  IF v_outstanding > 0 AND v_res.balance_settled_at IS NULL THEN
    RAISE EXCEPTION 'Record the remaining balance and payment method before handover.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.assert_reservation_command_rate('handover', _reservation_id);

  v_previous_status := v_res.status;
  v_extension_closed := v_res.extension_status = 'pending';

  UPDATE public.reservations
  SET status = 'Completed', updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    'Completed reservation handover',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'status', v_res.status,
      'balance_method', v_res.balance_settled_method,
      'extension_closed', v_extension_closed
    )
  );

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status);
END;
$$;

-- ============================================================
-- 7. Grants
-- ============================================================

REVOKE ALL ON FUNCTION public.compute_reservation_payment_due_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_reservation_capacity_dates(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_pending_blocking_reservation_change(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supersede_change_requests_on_terminal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_pending_extension_on_terminal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_reservation_command_rate(text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.request_reschedule_v2(uuid, date, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_ready_cancellation(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_reschedule_request_v2(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_ready_cancellation_request(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_reservation_cancellation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_reservation_as_manager(uuid, text, date, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_reservation_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_reservation_handover(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.request_reschedule_v2(uuid, date, time, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_ready_cancellation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_reschedule_request_v2(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_ready_cancellation_request(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_reservation_cancellation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_reservation_as_manager(uuid, text, date, time, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_reservation_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_reservation_handover(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 8. Narrow data repair
-- ============================================================

-- Terminal reservations still showing a live extension request.
UPDATE public.reservations
SET extension_status = 'closed',
    extension_resolved_at = now(),
    extension_deadline_at = NULL,
    extension_resolution_notes = CASE
      WHEN lower(status) = 'completed' THEN 'Closed automatically because order was collected.'
      ELSE 'Closed automatically because reservation became ' || status || '.'
    END
WHERE extension_status = 'pending'
  AND lower(trim(coalesce(status, ''))) IN ('completed', 'cancelled', 'unclaimed');

-- Complete legacy pending reschedules on active reservations move into the canonical table.
INSERT INTO public.reservation_change_requests (
  reservation_id, customer_id, request_type, reason, requested_for, original_for,
  reservation_status_at_request, payment_status_at_request, created_at
)
SELECT r.id, r.customer_id, 'reschedule',
       'Legacy request - reason was not recorded by the previous system.',
       r.reschedule_requested_at_time, r.appointment_time,
       r.status, r.payment_status, r.reschedule_requested_at
FROM public.reservations r
WHERE r.reschedule_requested_at IS NOT NULL
  AND r.reschedule_requested_at_time IS NOT NULL
  AND r.customer_id IS NOT NULL
  AND coalesce(r.deleted, false) = false
  AND lower(trim(coalesce(r.status, ''))) NOT IN ('completed', 'cancelled', 'unclaimed')
  AND NOT EXISTS (
    SELECT 1 FROM public.reservation_change_requests c
    WHERE c.reservation_id = r.id AND c.status = 'pending'
  );
