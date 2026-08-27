-- Reservations fail at INSERT with 42804:
--   column "appointment_time" is of type timestamp with time zone but
--   expression is of type time without time zone
--
-- reservations.appointment_time is timestamptz on the shared DB. The
-- owner-dashboard repo owns that shape: src/services/reservationService.js
-- packs date + "HH:MM" into a timestamptz at +08:00 on write and unpacks it
-- back to "HH:MM" on read. Our RPCs instead cast the client's wall-clock
-- string with ::time, which has no implicit cast to timestamptz, so every
-- customer reservation errors out.
--
-- Adapt our side to the existing column rather than changing its type --
-- an ALTER to `time` would break the owner dashboard's read and write paths.
--
-- Store timezone is fixed Asia/Manila (+08, no DST). Anchoring explicitly
-- matters because the Postgres session timezone is UTC: a 10:00 Manila
-- appointment stored as timestamptz reads back as 02:00 under a bare ::time,
-- which is what would have made validate_reservation_time reject every slot
-- as outside operating hours even after the insert was fixed.

CREATE OR REPLACE FUNCTION public.create_reservation(
  _product_id uuid,
  _size text,
  _color text,
  _quantity integer,
  _date text,
  _appointment_time text,
  _receipt_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_deposit numeric;
  v_appointment timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _quantity IS NULL OR _quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be positive.';
  END IF;

  IF _receipt_path IS NULL OR _receipt_path = '' THEN
    RAISE EXCEPTION 'Proof of downpayment is required.';
  END IF;

  -- Receipts are uploaded to payment_receipts/{auth.uid()}/... by storage RLS;
  -- double-check here as defense in depth.
  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
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

  v_deposit := round(v_product.price * 0.5, 2);

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
    payment_status, payment_type
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
    _receipt_path,
    'Pending',
    'Pending',
    'Deposit'
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_reservation(
  _reservation_id uuid,
  _date text,
  _appointment_time text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Only pending or confirmed reservations can be rescheduled.';
  END IF;

  -- trg_validate_reservation_time enforces operating hours + slot capacity here.
  UPDATE public.reservations
  SET date = _date::date,
      appointment_time = (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila'
  WHERE id = _reservation_id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) TO authenticated;

-- Same timezone bug on the read side of the validator: comparing a UTC-rendered
-- appointment against Manila store_hours rejected every valid slot.
CREATE OR REPLACE FUNCTION public.validate_reservation_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  day_idx integer;
  standard_hours record;
  closure_record record;
  store_open time;
  store_close time;
  appt_time time;
  existing_count integer;
BEGIN
  IF NEW.date IS NULL OR NEW.appointment_time IS NULL THEN
    RETURN NEW;
  END IF;

  appt_time := (NEW.appointment_time AT TIME ZONE 'Asia/Manila')::time;

  IF (EXTRACT(minute FROM appt_time)::integer % 30) <> 0
     OR EXTRACT(second FROM appt_time)::integer <> 0 THEN
    RAISE EXCEPTION 'Appointment time must be on a 30-minute boundary.';
  END IF;

  day_idx := EXTRACT(dow FROM NEW.date::date);

  SELECT *
  INTO standard_hours
  FROM public.store_hours
  WHERE day_of_week = day_idx;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store hours are not configured for this day.';
  END IF;

  SELECT *
  INTO closure_record
  FROM public.store_closures
  WHERE closure_date = NEW.date::date;

  IF FOUND THEN
    IF COALESCE(closure_record.is_fully_closed, true) THEN
      RAISE EXCEPTION 'Boutique is closed on this date: %', COALESCE(closure_record.reason, 'Closed');
    END IF;

    store_open := COALESCE(closure_record.custom_open_time, standard_hours.open_time);
    store_close := COALESCE(closure_record.custom_close_time, standard_hours.close_time);
  ELSE
    IF COALESCE(standard_hours.is_closed, false) THEN
      RAISE EXCEPTION 'Boutique is normally closed on this day of the week.';
    END IF;

    store_open := standard_hours.open_time;
    store_close := standard_hours.close_time;
  END IF;

  IF store_open IS NULL OR store_close IS NULL OR store_open >= store_close THEN
    RAISE EXCEPTION 'Store hours are invalid for this date.';
  END IF;

  IF appt_time < store_open OR appt_time >= store_close THEN
    RAISE EXCEPTION 'Appointment time is outside of operating hours (% - %).', store_open, store_close;
  END IF;

  IF COALESCE(NEW.deleted, false) = false
     AND lower(COALESCE(NEW.status, 'pending')) NOT IN ('cancelled', 'completed') THEN
    SELECT count(*)
    INTO existing_count
    FROM public.reservations r
    WHERE r.date::date = NEW.date::date
      AND (r.appointment_time AT TIME ZONE 'Asia/Manila')::time = appt_time
      AND COALESCE(r.deleted, false) = false
      AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
      AND (TG_OP = 'INSERT' OR r.id <> NEW.id);

    IF existing_count >= 3 THEN
      RAISE EXCEPTION 'This time slot is fully booked. Please select another time.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
