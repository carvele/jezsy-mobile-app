-- Moves payment back to AFTER staff acceptance, and fixes the traps that made
-- the previous attempt at this unworkable.
--
-- 20260730050945 implemented confirm-then-pay; 20260730051910 reversed it to
-- pay-at-creation. Going back to confirm-first, deliberately, because taking
-- money before staff have vetted a booking means owing a GCash refund whenever
-- staff reject one, and PayMongo refunds are manual.
--
-- Three things the earlier version got wrong, all fixed here:
--
--   1. A 120-minute window is indefensible once the clock starts on a STAFF
--      action rather than a customer one -- it can elapse entirely while the
--      customer is asleep. 24 hours, capped so it never outlives the pickup
--      appointment itself.
--   2. Nothing told the customer why an expired reservation was cancelled.
--   3. An uploaded receipt was still swept on a timer even though only a human
--      can judge it. Receipts now park in payment_status 'Submitted' and wait
--      for staff. The abuse ceiling is "held until staff look", not "held
--      forever": a junk image is cancelled by staff rejecting it.

-- 1. No clock at creation. A reservation sits Pending, unpaid and unexpiring,
--    until staff accept it.
create or replace function public.create_reservation(
  _product_id uuid,
  _size text,
  _color text,
  _quantity integer,
  _date text,
  _appointment_time text,
  _receipt_path text,
  _payment_option text default 'deposit'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_deposit numeric;
  v_appointment timestamptz;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_option NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;

  IF _quantity IS NULL OR _quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be positive.';
  END IF;

  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  SELECT
    id,
    name,
    image_url,
    CASE
      WHEN COALESCE(on_sale, false) AND sale_price IS NOT NULL AND sale_price > 0
        THEN sale_price
      ELSE COALESCE(price, 0)
    END::numeric AS price
  INTO v_product
  FROM public.products
  WHERE id = _product_id
    AND visibility = 'public'
    AND COALESCE(deleted, false) = false
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product is unavailable.';
  END IF;

  IF v_product.price <= 0 THEN
    RAISE EXCEPTION 'Product price is invalid.';
  END IF;

  SELECT first_name, last_name INTO v_profile
  FROM public.profiles WHERE id = v_user_id;

  IF v_option = 'full' THEN
    v_deposit := round(v_product.price, 2);
    v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_product.price * 0.5, 2);
    v_payment_type := 'Deposit';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
                    || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations WHERE display_id = v_display_id);

    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate reservation number.';
    END IF;
  END LOOP;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at
  )
  VALUES (
    v_display_id,
    v_user_id,
    COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    v_product.id,
    v_product.name,
    v_product.image_url,
    NULLIF(_size, ''),
    NULLIF(_color, ''),
    _quantity,
    v_product.price,
    v_deposit,
    _date::date,
    (_date::date + 4),
    v_appointment,
    NULLIF(_receipt_path, ''),
    'Pending',
    'Pending',
    v_payment_type,
    NULL  -- set on acceptance, not here
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

revoke all on function public.create_reservation(uuid, text, text, integer, text, text, text, text) from public;
revoke all on function public.create_reservation(uuid, text, text, integer, text, text, text, text) from anon;
grant execute on function public.create_reservation(uuid, text, text, integer, text, text, text, text) to authenticated;

-- 2. The clock starts when staff accept, because that is when the customer is
--    first able to pay. Capped an hour before the appointment so accepting at
--    23:00 for a 10:00 pickup cannot hand out a window that outlives the
--    booking. COALESCE so toggling status does not keep granting fresh time.
create or replace function public.set_payment_due_on_confirm()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'confirmed'
     AND lower(COALESCE(OLD.status, '')) <> 'confirmed'
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

drop trigger if exists trg_set_payment_due_on_confirm on public.reservations;
create trigger trg_set_payment_due_on_confirm
before update on public.reservations
for each row
execute function public.set_payment_due_on_confirm();

revoke execute on function public.set_payment_due_on_confirm() from public, anon, authenticated;

-- 3. Sweep targets Confirmed-but-unpaid again. 'Submitted' is skipped: a
--    receipt is waiting on a human, and a timer cannot judge an image.
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
    WHERE lower(COALESCE(status, '')) = 'confirmed'
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

comment on column public.reservations.payment_due_at is
  'Deadline for the customer to pay, set when staff confirm the reservation (24h, capped an hour before the appointment). NULL while still Pending -- an unaccepted reservation never expires. Unpaid past this point is cancelled by expire_unpaid_reservations().';

-- 4. Let the customer attach a receipt to an already-accepted reservation.
--    Customers have no UPDATE on reservations (admin-only by RLS), so this is
--    the only write path -- SECURITY DEFINER with its own ownership guard,
--    matching how create_reservation is trusted. It records the claim only;
--    marking it Paid stays a staff decision.
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _receipt_path IS NULL OR _receipt_path = '' THEN
    RAISE EXCEPTION 'A receipt is required.';
  END IF;

  -- Same ownership check create_reservation applies: the storage path is
  -- prefixed with the uploader's id, so a customer cannot attach someone
  -- else's upload.
  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = _reservation_id
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_reservation.customer_id <> v_user_id THEN
    RAISE EXCEPTION 'Not your reservation.';
  END IF;

  IF lower(COALESCE(v_reservation.payment_status, '')) = 'paid' THEN
    RAISE EXCEPTION 'This reservation is already paid.';
  END IF;

  IF lower(COALESCE(v_reservation.status, '')) <> 'confirmed' THEN
    RAISE EXCEPTION 'This reservation is not awaiting payment yet.';
  END IF;

  UPDATE public.reservations
  SET receipt_url = _receipt_path,
      payment_status = 'Submitted'
  WHERE id = _reservation_id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

revoke all on function public.submit_reservation_receipt(uuid, text) from public;
revoke all on function public.submit_reservation_receipt(uuid, text) from anon;
grant execute on function public.submit_reservation_receipt(uuid, text) to authenticated;

-- 5. Notifications now say what the customer has to do, and why something was
--    cancelled. "Confirmed" used to read as "you are done"; it is now the
--    moment payment is actually required.
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
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE lower(coalesce(NEW.status, ''))
    WHEN 'confirmed' THEN
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
    WHEN 'completed' THEN
      v_title := 'Reservation Completed';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' is complete. We hope you loved it!';
    WHEN 'cancelled' THEN
      -- Distinguish the sweep from a staff cancellation: only an unpaid,
      -- past-deadline row can have been taken by expire_unpaid_reservations.
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
  END CASE;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.customer_id,
    'reservation',
    v_title,
    v_body,
    jsonb_build_object('reservation_id', NEW.id, 'display_id', NEW.display_id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$function$;
