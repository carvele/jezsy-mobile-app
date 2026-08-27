-- Payment moves to AFTER staff acceptance, with a 120-minute window.
--
-- New flow:
--   1. Customer reserves -- date and time only. No payment, no receipt.
--   2. Staff accept -> status Confirmed. That sets payment_due_at to now + 120m.
--   3. Customer pays the reservation fee within the window.
--   4. Unpaid past the deadline -> Cancelled.
--
-- This is also the AUTHORITATIVE create_reservation definition. 20260730093000
-- (payments) previously carried its own copy built from the pre-timezone-fix
-- version, which would have reverted the Asia/Manila anchoring from
-- 20260730002045 and broken every reservation at INSERT again. That copy is
-- removed there; this is the only place the function is rewritten.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;

COMMENT ON COLUMN public.reservations.payment_due_at IS
  'Deadline for the customer to pay the reservation fee. Set when staff confirm the reservation; unpaid past this point is cancelled by expire_unpaid_reservations().';

-- Set the clock on the confirm transition rather than at creation: the window
-- is meant to start when the customer is first *able* to pay.
CREATE OR REPLACE FUNCTION public.set_payment_due_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'confirmed'
     AND lower(COALESCE(OLD.status, '')) <> 'confirmed'
     AND lower(COALESCE(NEW.payment_status, '')) <> 'paid' THEN
    -- COALESCE so a staff member toggling status back and forth does not keep
    -- handing the customer a fresh two hours.
    NEW.payment_due_at := COALESCE(NEW.payment_due_at, now() + interval '120 minutes');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_payment_due_on_confirm ON public.reservations;
CREATE TRIGGER trg_set_payment_due_on_confirm
BEFORE UPDATE ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.set_payment_due_on_confirm();

REVOKE EXECUTE ON FUNCTION public.set_payment_due_on_confirm() FROM PUBLIC, anon, authenticated;

-- The sweep. SECURITY DEFINER because it has to update rows across all
-- customers, which no customer's own RLS allows.
--
-- Idempotent and safe to call as often as you like: the WHERE clause only ever
-- matches a confirmed, unpaid, past-deadline reservation.
CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservations
    SET status = 'Cancelled'
    WHERE lower(COALESCE(status, '')) = 'confirmed'
      AND lower(COALESCE(payment_status, '')) <> 'paid'
      AND payment_due_at IS NOT NULL
      AND payment_due_at < now()
      AND COALESCE(deleted, false) = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

-- Staff and the service_role call this. Customers must not be able to cancel
-- other people's reservations, even though the function only touches
-- past-deadline rows.
REVOKE EXECUTE ON FUNCTION public.expire_unpaid_reservations() FROM PUBLIC, anon, authenticated;

-- Authoritative create_reservation. Differences from 20260730002045:
--   * The receipt path is now OPTIONAL. Payment happens after confirmation, so
--     requiring proof up front no longer makes sense. When one is supplied it
--     is still checked to belong to the caller.
--   * payment_type stays 'Deposit' rather than becoming 'Reservation Fee'. The
--     rename the customer asked for is UI wording; changing the stored value
--     could break owner-dashboard filters on a shared table.
-- The Asia/Manila anchoring is preserved verbatim -- it is load-bearing.
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

  -- Optional now. Still verified against the caller when present, since storage
  -- RLS writes to payment_receipts/{auth.uid()}/...
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
    NULLIF(_receipt_path, ''),
    'Pending',
    'Pending',
    'Deposit'
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;
