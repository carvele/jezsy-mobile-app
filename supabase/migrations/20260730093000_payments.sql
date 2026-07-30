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

-- NOTE: this migration deliberately does NOT touch create_reservation.
--
-- It used to carry its own CREATE OR REPLACE of that function, copied from the
-- body that existed before 20260730002045 anchored appointment_time to
-- Asia/Manila. Applied in that state it would have silently reverted the
-- anchoring and reproduced the 42804 failure that broke every reservation at
-- INSERT.
--
-- The authoritative definition now lives in
-- 20260730051910_payment_before_confirm.sql, which is also where the receipt
-- becomes optional and payment_due_at is stamped. One owner, one definition.
