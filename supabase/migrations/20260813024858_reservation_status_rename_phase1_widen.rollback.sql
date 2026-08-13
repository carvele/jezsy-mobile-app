-- Rollback for 20260813024858_reservation_status_rename_phase1_widen.sql
-- Restores the pre-Phase-1 constraint and function bodies. Safe only if no
-- row has been written with status = 'Preparing' since the forward
-- migration applied (none of the old code paths can produce that value, so
-- this holds true until Phase 2/3 ship and start writing it).

ALTER TABLE public.reservations DROP CONSTRAINT reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status = ANY (ARRAY[
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'To Pickup', 'Fitting', 'Active', 'Ready',
    'Completed', 'Cancelled'
  ])) NOT VALID;

CREATE OR REPLACE FUNCTION public.is_awaiting_payment_status(_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$ select lower(coalesce(_status, '')) in ('confirmed', 'to pay'); $function$;

CREATE OR REPLACE FUNCTION public.verify_pickup(_pickup_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reservation public.reservations%rowtype;
  v_status text;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Staff access required.';
  END IF;

  IF _pickup_token IS NULL THEN
    RAISE EXCEPTION 'A pickup token is required.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE pickup_token = _pickup_token
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pickup pass not recognized.';
  END IF;

  v_status := lower(COALESCE(v_reservation.status, 'pending'));
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'This reservation was already picked up.';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Only reservations ready for pickup can be picked up.';
  END IF;

  UPDATE public.reservations
  SET status = 'Completed',
      updated_at = now()
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_reservation(_reservation_id uuid, _date text, _appointment_time text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A new date and appointment time are required.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = _reservation_id
    AND customer_id = v_user_id
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_status := lower(COALESCE(v_reservation.status, 'pending'));
  IF v_status NOT IN ('pending', 'confirmed', 'to pay', 'to pickup', 'fitting', 'active') THEN
    RAISE EXCEPTION 'Only pending or confirmed reservations can be rescheduled.';
  END IF;

  UPDATE public.reservations
  SET date = _date::date,
      appointment_time = (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila'
  WHERE id = _reservation_id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_reschedule(_reservation_id uuid, _date text, _appointment_time text)
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
  IF v_status NOT IN ('pending', 'request approval', 'confirmed', 'to pay', 'to pickup', 'fitting') THEN
    RAISE EXCEPTION 'This reservation can no longer be rescheduled.';
  END IF;

  IF v_res.reschedule_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a reschedule request waiting for review.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

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

CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservations SET status = 'Cancelled'
    WHERE lower(COALESCE(status, '')) IN ('confirmed', 'to pay')
      AND lower(COALESCE(payment_status, '')) NOT IN ('paid', 'submitted')
      AND payment_due_at IS NOT NULL AND payment_due_at < now()
      AND COALESCE(deleted, false) = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;
  RETURN v_expired;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_payment_due_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new text := lower(coalesce(NEW.status, ''));
  v_old text := lower(coalesce(OLD.status, ''));
BEGIN
  IF v_new IN ('confirmed', 'to pay')
     AND v_old NOT IN ('confirmed', 'to pay')
     AND lower(COALESCE(NEW.payment_status, '')) NOT IN ('paid', 'submitted') THEN
    NEW.payment_due_at := COALESCE(
      NEW.payment_due_at,
      least(now() + interval '24 hours',
            COALESCE(NEW.appointment_time - interval '1 hour', now() + interval '24 hours'))
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text; v_body text;
  v_status text := lower(coalesce(NEW.status, ''));
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  IF v_status IN ('confirmed', 'to pay') THEN
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
  ELSIF v_status IN ('to pickup', 'fitting', 'active') THEN
    v_title := 'Reservation Updated';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is now ' || NEW.status || '.';
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
                 || ' has been cancelled.';
    END IF;
  ELSE
    v_title := 'Reservation Updated';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is now ' || NEW.status || '.';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (NEW.customer_id, 'reservation', v_title, v_body,
    jsonb_build_object('reservation_id', NEW.id, 'display_id', NEW.display_id, 'status', NEW.status));

  RETURN NEW;
END;
$function$;
