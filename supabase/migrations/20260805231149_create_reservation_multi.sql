-- Multi-item reservation creation.
--
-- create_reservation_multi() takes a jsonb array of lines instead of a
-- single product. It keeps every guard the single-item RPC already had --
-- auth check, caller-derived customer id, receipt-path ownership, appointment
-- validation -- and resolves each line's price from the products table
-- rather than trusting the client, which is what made the old
-- create_reservations_from_cart() unsafe enough to drop.
--
-- SECURITY DEFINER is required, not preference: reservations (and now
-- reservation_items) have an admin-only INSERT policy, so an INVOKER RPC
-- would fail closed for every customer.
--
-- Two behaviours differ from the single-item RPC, both deliberate:
--   1. A line's cost is unit_price * quantity. The old RPC ignored quantity
--      when computing price, so reserving 3 of something charged for 1. No
--      existing row has quantity > 1 and the app hardcodes 1, so nothing
--      in flight changes.
--   2. The parent's rental_price is the reservation total (sum of lines).
--      For a single line at quantity 1 that equals the old per-unit meaning,
--      so existing rows and readers are unaffected.

CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL,
  _payment_option text DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_appointment timestamptz;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
  v_item jsonb;
  v_quantity integer;
  v_total numeric := 0;
  v_deposit numeric;
  v_line_count integer;
  v_first jsonb;
  v_first_product record;
  v_items_resolved jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_option NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;

  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A reservation must contain at least one item.';
  END IF;

  v_line_count := jsonb_array_length(_items);
  IF v_line_count > 20 THEN
    RAISE EXCEPTION 'A reservation cannot contain more than 20 items.';
  END IF;

  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  -- Price every line server-side first, so a bad line aborts before any row
  -- is written rather than leaving a half-built reservation behind.
  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);
    IF v_quantity < 1 THEN
      RAISE EXCEPTION 'Quantity must be positive.';
    END IF;

    SELECT id, name, image_url,
      CASE WHEN COALESCE(on_sale, false) AND sale_price IS NOT NULL AND sale_price > 0
        THEN sale_price ELSE COALESCE(price, 0) END::numeric AS price
    INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND visibility = 'public'
      AND COALESCE(deleted, false) = false
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One of the selected products is unavailable.';
    END IF;
    IF v_product.price <= 0 THEN
      RAISE EXCEPTION 'One of the selected products has an invalid price.';
    END IF;

    v_total := v_total + (v_product.price * v_quantity);

    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'image_url', v_product.image_url,
      'size', NULLIF(v_item->>'size', ''),
      'color', NULLIF(v_item->>'color', ''),
      'quantity', v_quantity,
      'unit_price', v_product.price
    );
  END LOOP;

  IF v_option = 'full' THEN
    v_deposit := round(v_total, 2);
    v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_total * 0.5, 2);
    v_payment_type := 'Deposit';
  END IF;

  SELECT first_name, last_name INTO v_profile FROM public.profiles WHERE id = v_user_id;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
                    || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations WHERE display_id = v_display_id);
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate reservation number.';
    END IF;
  END LOOP;

  -- Legacy parent product columns are filled from the first line so shipped
  -- app builds and admin screens that still read them show something
  -- coherent rather than nulls.
  v_first := v_items_resolved -> 0;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at
  ) VALUES (
    v_display_id, v_user_id,
    COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    (v_first->>'product_id')::uuid, v_first->>'product_name', v_first->>'image_url',
    v_first->>'size', v_first->>'color', (v_first->>'quantity')::integer,
    round(v_total, 2), v_deposit,
    _date::date, (_date::date + 4), v_appointment,
    NULLIF(_receipt_path, ''), 'Pending', 'Pending', v_payment_type,
    NULL
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price
  )
  SELECT
    v_reservation.id,
    (line->>'product_id')::uuid,
    line->>'product_name',
    line->>'image_url',
    line->>'size',
    line->>'color',
    (line->>'quantity')::integer,
    (line->>'unit_price')::numeric
  FROM jsonb_array_elements(v_items_resolved) AS line;

  RETURN to_jsonb(v_reservation) || jsonb_build_object('items', v_items_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text) TO authenticated;

-- Old app builds keep calling the single-item RPC, and a reservation it
-- creates must still have a line row or the new item-based readers show it
-- as empty. Same body as before plus the child insert.
CREATE OR REPLACE FUNCTION public.create_reservation(
  _product_id uuid,
  _size text,
  _color text,
  _quantity integer,
  _date text,
  _appointment_time text,
  _receipt_path text,
  _payment_option text DEFAULT 'deposit'
)
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
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at
  ) VALUES (
    v_display_id, v_user_id,
    COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity,
    v_product.price, v_deposit,
    _date::date, (_date::date + 4), v_appointment,
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
