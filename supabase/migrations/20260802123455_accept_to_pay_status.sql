-- Treats 'To Pay' as an awaiting-payment state alongside 'Confirmed'.
--
-- The live table already contains a reservation with status 'To Pay', a value
-- the mobile app has never recognised -- it only ever handled Pending,
-- Confirmed, Completed and Cancelled. The admin dashboard is a separate repo,
-- so which label staff acceptance actually writes is not visible from here.
--
-- That matters: 20260731170719 hung the payment deadline, the receipt guard
-- and the sweep on 'confirmed' alone. If staff acceptance sets 'To Pay'
-- instead, none of them would ever fire and confirm-then-pay would silently
-- do nothing at all.
--
-- Accepting both is deliberate rather than a guess at which one is right: it
-- works whichever label the dashboard uses, and keeps working if it changes.
-- A single source of truth would be better, but that has to be agreed across
-- both repos first.

create or replace function public.is_awaiting_payment_status(_status text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select lower(coalesce(_status, '')) in ('confirmed', 'to pay');
$$;

revoke all on function public.is_awaiting_payment_status(text) from public;
revoke all on function public.is_awaiting_payment_status(text) from anon;

create or replace function public.set_payment_due_on_confirm()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
BEGIN
  IF public.is_awaiting_payment_status(NEW.status)
     AND NOT public.is_awaiting_payment_status(OLD.status)
     AND lower(COALESCE(NEW.payment_status, '')) NOT IN ('paid', 'submitted') THEN
    NEW.payment_due_at := COALESCE(
      NEW.payment_due_at,
      least(
        now() + interval '24 hours',
        COALESCE(NEW.appointment_time - interval '1 hour', now() + interval '24 hours')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

create or replace function public.expire_unpaid_reservations()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
DECLARE
  v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservations
    SET status = 'Cancelled'
    WHERE public.is_awaiting_payment_status(status)
      AND lower(COALESCE(payment_status, '')) NOT IN ('paid', 'submitted')
      AND payment_due_at IS NOT NULL
      AND payment_due_at < now()
      AND COALESCE(deleted, false) = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

revoke execute on function public.expire_unpaid_reservations() from public, anon, authenticated;

create or replace function public.submit_reservation_receipt(
  _reservation_id uuid,
  _receipt_path text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF _receipt_path IS NULL OR _receipt_path = '' THEN RAISE EXCEPTION 'A receipt is required.'; END IF;
  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  SELECT * INTO v_reservation FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
  IF v_reservation.customer_id <> v_user_id THEN RAISE EXCEPTION 'Not your reservation.'; END IF;
  IF lower(COALESCE(v_reservation.payment_status, '')) = 'paid' THEN
    RAISE EXCEPTION 'This reservation is already paid.';
  END IF;
  IF NOT public.is_awaiting_payment_status(v_reservation.status) THEN
    RAISE EXCEPTION 'This reservation is not awaiting payment yet.';
  END IF;

  UPDATE public.reservations
  SET receipt_url = _receipt_path, payment_status = 'Submitted'
  WHERE id = _reservation_id RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

revoke all on function public.submit_reservation_receipt(uuid, text) from public;
revoke all on function public.submit_reservation_receipt(uuid, text) from anon;
grant execute on function public.submit_reservation_receipt(uuid, text) to authenticated;

create or replace function public.notify_reservation_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  IF public.is_awaiting_payment_status(NEW.status) THEN
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
  ELSIF lower(coalesce(NEW.status, '')) = 'completed' THEN
    v_title := 'Reservation Completed';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is complete. We hope you loved it!';
  ELSIF lower(coalesce(NEW.status, '')) = 'cancelled' THEN
    IF lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'submitted')
       AND NEW.payment_due_at IS NOT NULL
       AND NEW.payment_due_at <= now() THEN
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
