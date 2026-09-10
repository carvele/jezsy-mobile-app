-- PayMongo's payment.paid webhook event carries a Payment resource, which has
-- no checkout_session_id field -- only payment_intent_id. The webhook could
-- previously only match events shaped like a Checkout Session resource, so
-- every real payment.paid delivery silently fell into the "no session id"
-- no-op branch and never settled a payment. Storing the payment intent id at
-- checkout-session-creation time gives the webhook a second, reliable key to
-- match payment.paid events against.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_payment_intent_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_intent_key
  ON public.payments (provider, provider_payment_intent_id)
  WHERE (provider_payment_intent_id IS NOT NULL);
