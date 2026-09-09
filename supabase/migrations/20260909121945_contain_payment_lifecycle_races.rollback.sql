-- Restore the payment behavior that preceded the containment migration.

DROP TRIGGER IF EXISTS trg_guard_reservation_financial_state ON public.reservations;
DROP FUNCTION IF EXISTS public.guard_reservation_financial_state();
DROP INDEX IF EXISTS public.payments_one_paid_per_reservation;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_payment_status_check
  CHECK (payment_status IN ('Pending', 'Submitted', 'Processing', 'Paid'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.expire_all_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer;
  v_buffer interval := interval '5 minutes';
BEGIN
  WITH expired AS (
    UPDATE public.reservations
    SET status = 'Cancelled',
        cancellation_reason = CASE
          WHEN lower(trim(coalesce(status, ''))) IN ('pending', 'request approval')
            THEN 'Auto-cancelled: Appointment window passed without review'
          WHEN payment_due_at IS NOT NULL AND payment_due_at + v_buffer < now()
            THEN 'Auto-cancelled: Payment deadline passed'
          ELSE 'Auto-cancelled: Appointment time passed without payment'
        END,
        updated_at = now()
    WHERE coalesce(deleted, false) = false
      AND (
        (
          lower(trim(coalesce(status, ''))) IN ('pending', 'request approval')
          AND appointment_time IS NOT NULL
          AND appointment_time + v_buffer < now()
        )
        OR
        (
          lower(trim(coalesce(status, ''))) IN ('to pay', 'confirmed', 'approved')
          AND (
            (payment_due_at IS NOT NULL AND payment_due_at + v_buffer < now())
            OR (appointment_time IS NOT NULL AND appointment_time + v_buffer < now())
          )
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;
  RETURN v_expired;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservations SET status = 'Cancelled'
    WHERE lower(coalesce(status, '')) IN ('confirmed', 'approved', 'to pay')
      AND lower(coalesce(payment_status, '')) NOT IN ('paid', 'submitted')
      AND payment_due_at IS NOT NULL AND payment_due_at < now()
      AND coalesce(deleted, false) = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;
  RETURN v_expired;
END;
$function$;

DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-unpaid-reservations') THEN
    PERFORM cron.schedule(
      'expire-unpaid-reservations',
      '*/5 * * * *',
      $job$ SELECT public.expire_unpaid_reservations(); $job$
    );
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.expire_stale_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer;
BEGIN
  WITH stale AS (
    UPDATE public.payments
    SET status = 'failed'
    WHERE status IN ('awaiting_payment', 'processing')
      AND created_at < now() - interval '2 hours'
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM stale;
  RETURN v_expired;
END;
$function$;

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
  v_res record;
BEGIN
  IF _next_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Unsupported payment status.';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF v_payment.last_event_id = _event_id THEN
    RETURN jsonb_build_object('duplicate', true, 'status', v_payment.status);
  END IF;
  IF v_payment.status = 'paid' AND _next_status <> 'paid' THEN
    RETURN jsonb_build_object('ignored', 'already paid', 'status', v_payment.status);
  END IF;

  UPDATE public.payments
  SET status = _next_status,
      method = coalesce(_method, method),
      provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
      last_event_id = _event_id,
      last_event = _event
  WHERE id = _payment_id;

  IF _next_status = 'paid' AND v_payment.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET payment_status = 'Paid', updated_at = now()
    WHERE id = v_payment.reservation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found for payment.'; END IF;

    SELECT customer_id, product_name, display_id INTO v_res
    FROM public.reservations WHERE id = v_payment.reservation_id;
    IF v_res.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_res.customer_id, 'reservation', 'Payment received',
        'Your payment for ' || coalesce(v_res.product_name, 'your item') || ' has been received.',
        jsonb_build_object('reservation_id', v_payment.reservation_id, 'display_id', v_res.display_id, 'payment_status', 'Paid')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('status', _next_status);
END;
$function$;

DROP TABLE IF EXISTS public.processed_payment_webhook_events;
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS refund_required_at,
  DROP COLUMN IF EXISTS requires_refund,
  DROP COLUMN IF EXISTS attempt_started_at;

DROP POLICY IF EXISTS "Staff update payments" ON public.payments;
CREATE POLICY "Staff update payments"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());
GRANT UPDATE ON public.payments TO authenticated;
