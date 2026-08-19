-- Makes cross-system payment settlement retry-safe and preserves account
-- deletion requests when database scrubbing succeeds but auth deletion fails.

CREATE OR REPLACE FUNCTION public.settle_payment_webhook(
  _payment_id uuid,
  _next_status text,
  _method text,
  _provider_payment_id text,
  _event_id text,
  _event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment public.payments%rowtype;
BEGIN
  IF _next_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Unsupported payment status.';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = _payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;

  IF v_payment.last_event_id = _event_id THEN
    RETURN jsonb_build_object('duplicate', true, 'status', v_payment.status);
  END IF;

  IF v_payment.status = 'paid' AND _next_status <> 'paid' THEN
    RETURN jsonb_build_object('ignored', 'already paid', 'status', v_payment.status);
  END IF;

  UPDATE public.payments
  SET status = _next_status,
      method = COALESCE(_method, method),
      provider_payment_id = COALESCE(_provider_payment_id, provider_payment_id),
      last_event_id = _event_id,
      last_event = _event
  WHERE id = _payment_id;

  IF _next_status = 'paid' AND v_payment.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET payment_status = 'Paid', updated_at = now()
    WHERE id = v_payment.reservation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found for payment.'; END IF;
  END IF;

  RETURN jsonb_build_object('status', _next_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb) TO service_role;

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_status_check;
ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_status_check
  CHECK (status IN ('pending', 'auth_revocation_pending', 'completed', 'cancelled'));
