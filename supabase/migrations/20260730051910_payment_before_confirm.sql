-- Corrects the direction of the payment window, and schedules the sweep.
--
-- 20260730050945 implemented: reserve -> staff confirm -> pay within 120m.
-- The actual rule is the reverse:
--   reserve (Pending) -> pay within 120m -> staff confirm
--   unpaid past the deadline -> Cancelled
--
-- So the deadline belongs at creation, not on the confirm transition, and the
-- sweep must look at Pending rather than Confirmed. Staff confirmation is the
-- step AFTER payment, so nothing here touches it.

-- No longer needed: the window now starts at INSERT, so there is no transition
-- to hang a trigger on.
DROP TRIGGER IF EXISTS trg_set_payment_due_on_confirm ON public.reservations;
DROP FUNCTION IF EXISTS public.set_payment_due_on_confirm();

-- Sweep now targets Pending. A Confirmed reservation has, by definition, already
-- been paid and accepted, so it must never be swept.
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
    WHERE lower(COALESCE(status, '')) = 'pending'
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

REVOKE EXECUTE ON FUNCTION public.expire_unpaid_reservations() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.reservations.payment_due_at IS
  'Deadline for the customer to pay the reservation fee, set to 120 minutes after the reservation is created. Unpaid past this point is cancelled by expire_unpaid_reservations(). Staff confirm only after payment lands.';

-- Authoritative create_reservation. Same as 20260730050945 except payment_due_at
-- is stamped at INSERT. Asia/Manila anchoring from 20260730002045 preserved
-- verbatim -- it is load-bearing, and a copy of this function built from the
-- pre-fix body would silently break every reservation.
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
    'Deposit',
    now() + interval '120 minutes'
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;

-- Unattended expiry. Without a scheduler the 120-minute rule is not actually
-- enforced -- a reservation nobody looks at just sits there past its deadline.
-- pg_cron is additive (it creates a `cron` schema and touches nothing else),
-- but it IS a new extension on the shared database: tell the owner-dashboard
-- owner it is there.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-runnable: unschedule first, since cron.schedule on an existing job name
-- raises rather than replacing.
DO $$
BEGIN
  PERFORM cron.unschedule('expire-unpaid-reservations');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire-unpaid-reservations',
  '*/5 * * * *',
  $job$ SELECT public.expire_unpaid_reservations(); $job$
);
