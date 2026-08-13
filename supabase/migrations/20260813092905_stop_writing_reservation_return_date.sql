-- create_reservation() still inserted a synthetic return_date (pickup date +
-- 4 days) even though 20260720120000_reservation_drop_return_date.sql
-- deliberately dropped this: JezSy is reservation-only, not rental, so there
-- is no return flow for that date to describe. A later CREATE OR REPLACE
-- (20260722011025_reservation_respect_sale_price.sql, adding sale-price
-- handling) silently reintroduced the write. admin-dashboard's
-- reservationService.js reads and displays this column, so staff have been
-- seeing a fabricated date with no real business meaning on every
-- reservation since. This migration is the current function body with the
-- return_date column and its computed value removed from the INSERT --
-- nothing else changes.

CREATE OR REPLACE FUNCTION public.create_reservation(_product_id uuid, _size text, _color text, _quantity integer, _date text, _appointment_time text, _receipt_path text, _payment_option text DEFAULT 'deposit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record; v_product record; v_reservation public.reservations%rowtype;
  v_display_id text; v_attempt integer := 0; v_deposit numeric; v_appointment timestamptz;
  v_option text := lower(coalesce(_payment_option, 'deposit')); v_payment_type text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF v_option NOT IN ('deposit', 'full') THEN RAISE EXCEPTION 'Payment option must be deposit or full.'; END IF;
  IF _quantity IS NULL OR _quantity < 1 THEN RAISE EXCEPTION 'Quantity must be positive.'; END IF;
  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;
  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  SELECT id, name, image_url,
    CASE WHEN COALESCE(on_sale, false) AND sale_price IS NOT NULL AND sale_price > 0
      THEN sale_price ELSE COALESCE(price, 0) END::numeric AS price
  INTO v_product FROM public.products
  WHERE id = _product_id AND visibility = 'public' AND COALESCE(deleted, false) = false
  FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Product is unavailable.'; END IF;
  IF v_product.price <= 0 THEN RAISE EXCEPTION 'Product price is invalid.'; END IF;

  SELECT first_name, last_name INTO v_profile FROM public.profiles WHERE id = v_user_id;

  IF v_option = 'full' THEN
    v_deposit := round(v_product.price, 2); v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_product.price * 0.5, 2); v_payment_type := 'Deposit';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
                    || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations WHERE display_id = v_display_id);
    IF v_attempt > 10 THEN RAISE EXCEPTION 'Could not allocate reservation number.'; END IF;
  END LOOP;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at
  ) VALUES (
    v_display_id, v_user_id,
    COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity,
    v_product.price, v_deposit,
    _date::date, v_appointment,
    NULLIF(_receipt_path, ''), 'Pending', 'Pending', v_payment_type,
    NULL
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price
  ) VALUES (
    v_reservation.id, v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity, v_product.price
  );

  RETURN to_jsonb(v_reservation);
END;
$function$;
