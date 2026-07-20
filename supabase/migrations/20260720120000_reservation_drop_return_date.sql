-- Migration: Stop writing return_date in create_reservation
--
-- JezSy is a reservation system, not a rental system: customers reserve an
-- item for pickup and never return it. There is no return event, so there is
-- no return date to compute.
--
-- The previous client-side code in app/reserve/[id].tsx set
-- return_date = date + 4 days, and 20260719130000_create_reservation_rpc.sql
-- carried that expression over verbatim when moving pricing server-side. That
-- promoted a rental-model assumption from incidental client code into a
-- server-enforced business rule, which is worse: the value now looks
-- authoritative.
--
-- public.reservations.return_date is nullable with no default and is read
-- nowhere in the mobile app (only present in generated types), so omitting it
-- from the INSERT simply leaves it NULL. The column itself is left in place
-- rather than dropped, since the separate staff/admin app may still select it;
-- dropping it needs coordination with that app.
--
-- Everything else about the function is unchanged from
-- 20260719130000_create_reservation_rpc.sql: server-side price lookup, the
-- receipt-ownership check, display_id allocation, and the 50% deposit (which
-- remains valid -- it is a downpayment, not a rental security deposit).

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
SECURITY INVOKER
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

  SELECT id, name, image_url, COALESCE(price, 0)::numeric AS price
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
    date, appointment_time, receipt_url, status,
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
    _appointment_time::time,
    _receipt_path,
    'Pending',
    'Pending',
    'Deposit'
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;
