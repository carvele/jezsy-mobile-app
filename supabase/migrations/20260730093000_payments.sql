-- Feature: PayMongo payment gateway (GCash, GrabPay, card).
--
-- The security model is the point of this table, so it is worth stating
-- plainly: customers get SELECT only. There is deliberately no INSERT, UPDATE
-- or DELETE policy for them. Every write happens in the payments-create and
-- payments-webhook Edge Functions using the service_role key, which bypasses
-- RLS. A client that could write here could mark its own payment paid.
--
-- Amounts are stored in centavos because that is the unit PayMongo works in,
-- and integer arithmetic avoids the rounding drift a numeric round-trip would
-- introduce between our total and theirs.

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Reservations only. The buy-and-ship path is being retired, so there is no
    -- order_id here and nothing for this table to settle but a deposit.
    reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'paymongo',
    -- Checkout Session id, and the Payment id that session eventually produces.
    provider_ref text,
    provider_payment_id text,
    amount_centavos bigint NOT NULL,
    currency text NOT NULL DEFAULT 'PHP',
    status text NOT NULL DEFAULT 'awaiting_payment',
    method text,
    -- Idempotency key for the webhook: the same event delivered twice must not
    -- apply twice.
    last_event_id text,
    last_event jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT payments_amount_positive CHECK (amount_centavos > 0),
    CONSTRAINT payments_status_check CHECK (
      status IN ('awaiting_payment', 'processing', 'paid', 'failed', 'cancelled', 'refunded')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_key
  ON public.payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_reservation_id_idx ON public.payments (reservation_id);

-- Only one live attempt per reservation, so a customer tapping Pay twice reuses
-- or replaces rather than accumulating open sessions. Terminal rows are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_reservation
  ON public.payments (reservation_id)
  WHERE status IN ('awaiting_payment', 'processing');

DROP TRIGGER IF EXISTS trg_payments_touch_updated_at ON public.payments;
CREATE TRIGGER trg_payments_touch_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own payments" ON public.payments;
CREATE POLICY "Users read own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Staff read all payments" ON public.payments;
CREATE POLICY "Staff read all payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- Staff may correct a payment (mark refunded, reconcile a stuck row). Customers
-- still have no write path of any kind.
DROP POLICY IF EXISTS "Staff update payments" ON public.payments;
CREATE POLICY "Staff update payments"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- A null receipt path used to be rejected outright. It now means "this one is
-- being paid through the gateway": the reservation is created with
-- payment_type 'Gateway' and stays payment_status 'Pending' until the
-- payments-webhook function confirms it. The guard against an unpaid
-- reservation moves from this function to the payments row.
--
-- Signature is unchanged on purpose. Adding a defaulted argument would create a
-- second overload and make existing 7-argument calls ambiguous, including any
-- in the admin-dashboard repo.
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
  v_via_gateway boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _quantity IS NULL OR _quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be positive.';
  END IF;

  v_via_gateway := _receipt_path IS NULL OR _receipt_path = '';

  IF NOT v_via_gateway AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
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
    CASE WHEN v_via_gateway THEN NULL ELSE _receipt_path END,
    'Pending',
    'Pending',
    CASE WHEN v_via_gateway THEN 'Gateway' ELSE 'Deposit' END
  )
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

-- CREATE OR REPLACE resets grants on some paths; re-assert the locked-down set
-- established by 20260727075852. Verify with has_function_privilege, since
-- REVOKE FROM anon alone is a no-op against the PUBLIC default grant.
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;
