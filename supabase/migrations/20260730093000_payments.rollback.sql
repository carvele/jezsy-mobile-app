-- Reverts 20260730093000_payments.sql
--
-- Drops the payments table and restores create_reservation's hard requirement
-- for a receipt path. Check for non-terminal payments rows before running this:
-- any reservation created through the gateway will be left with
-- payment_type 'Gateway' and no receipt, and nothing to reconcile it against.

DROP POLICY IF EXISTS "Staff update payments" ON public.payments;
DROP POLICY IF EXISTS "Staff read all payments" ON public.payments;
DROP POLICY IF EXISTS "Users read own payments" ON public.payments;

DROP TRIGGER IF EXISTS trg_payments_touch_updated_at ON public.payments;

DROP INDEX IF EXISTS public.payments_one_open_per_reservation;
DROP INDEX IF EXISTS public.payments_reservation_id_idx;
DROP INDEX IF EXISTS public.payments_user_id_idx;
DROP INDEX IF EXISTS public.payments_provider_ref_key;

DROP TABLE IF EXISTS public.payments;

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
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

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
    _appointment_time::time,
    _receipt_path,
    'Pending',
    'Pending',
    'Deposit'
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;
