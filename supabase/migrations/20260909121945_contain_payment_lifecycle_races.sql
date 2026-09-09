-- Contain payment/expiry races before broader lifecycle command work.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS requires_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_required_at timestamptz;

CREATE TABLE IF NOT EXISTS public.processed_payment_webhook_events (
  event_id text PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  next_status text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processed_payment_webhook_events FROM PUBLIC, anon, authenticated;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_payment_status_check
  CHECK (
    payment_status IS NOT NULL
    AND payment_status IN ('Pending', 'Submitted', 'Processing', 'Paid', 'Refund Required', 'Refunded')
  )
  NOT VALID;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_payment_status_check;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid_per_reservation
  ON public.payments (reservation_id)
  WHERE status = 'paid';

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF current_user = 'authenticated'
     AND auth.uid() = OLD.customer_id
     AND NOT public.is_admin_or_owner()
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     ) THEN
    RAISE EXCEPTION 'Use an authorized reservation command to change lifecycle or payment state.'
      USING ERRCODE = '42501';
  END IF;

  IF lower(coalesce(OLD.payment_status, '')) = 'paid'
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'A paid reservation cannot be marked unpaid.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) = 'cancelled'
     AND lower(coalesce(NEW.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required') THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) IN ('preparing', 'ready', 'to pickup')
     AND lower(coalesce(NEW.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before preparing this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_reservation_financial_state ON public.reservations;
CREATE TRIGGER trg_guard_reservation_financial_state
BEFORE UPDATE OF status, payment_status ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.guard_reservation_financial_state();

REVOKE EXECUTE ON FUNCTION public.guard_reservation_financial_state() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_all_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_expired integer;
  v_buffer interval := interval '5 minutes';
BEGIN
  WITH candidates AS (
    SELECT r.id
    FROM public.reservations r
    WHERE coalesce(r.deleted, false) = false
      AND lower(trim(coalesce(r.payment_status, ''))) NOT IN
        ('paid', 'submitted', 'processing', 'refund required')
      AND NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.reservation_id = r.id
          AND p.status IN ('awaiting_payment', 'processing', 'paid')
      )
      AND (
        (
          lower(trim(coalesce(r.status, ''))) IN ('pending', 'request approval')
          AND r.appointment_time IS NOT NULL
          AND r.appointment_time + v_buffer < now()
        )
        OR
        (
          lower(trim(coalesce(r.status, ''))) IN ('to pay', 'confirmed', 'approved')
          AND (
            (r.payment_due_at IS NOT NULL AND r.payment_due_at + v_buffer < now())
            OR (r.appointment_time IS NOT NULL AND r.appointment_time + v_buffer < now())
          )
        )
      )
    FOR UPDATE OF r SKIP LOCKED
  ), expired AS (
    UPDATE public.reservations r
    SET status = 'Cancelled',
        cancellation_reason = CASE
          WHEN lower(trim(coalesce(r.status, ''))) IN ('pending', 'request approval')
            THEN 'Auto-cancelled: Appointment window passed'
          WHEN r.payment_due_at IS NOT NULL AND r.payment_due_at + v_buffer < now()
            THEN 'Auto-cancelled: Payment deadline passed'
          ELSE 'Auto-cancelled: Appointment time passed without payment'
        END,
        updated_at = now()
    FROM candidates c
    WHERE r.id = c.id
    RETURNING r.id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_all_stale_reservations() FROM PUBLIC, anon, authenticated;

-- Retain the legacy function for compatibility, but make it use the one
-- authoritative implementation and remove its duplicate cron schedule.
CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.expire_all_stale_reservations();
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_unpaid_reservations() FROM PUBLIC, anon, authenticated;

DO $block$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-unpaid-reservations';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.expire_stale_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_expired integer;
BEGIN
  WITH stale AS (
    UPDATE public.payments
    SET status = 'failed'
    WHERE status IN ('awaiting_payment', 'processing')
      AND coalesce(attempt_started_at, created_at) < now() - interval '2 hours'
      AND requires_refund = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM stale;

  RETURN v_expired;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_payments() FROM PUBLIC, anon, authenticated;

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
SET search_path TO ''
AS $function$
DECLARE
  v_payment public.payments%rowtype;
  v_res public.reservations%rowtype;
  v_recorded integer;
  v_refund_required boolean := false;
BEGIN
  IF _next_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Unsupported payment status.';
  END IF;
  IF nullif(trim(_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'Payment event ID is required.';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = _payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  INSERT INTO public.processed_payment_webhook_events (event_id, payment_id, next_status)
  VALUES (_event_id, _payment_id, _next_status)
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  IF v_recorded = 0 THEN
    RETURN jsonb_build_object('duplicate', true, 'status', v_payment.status);
  END IF;

  IF v_payment.status = 'paid' AND _next_status <> 'paid' THEN
    RETURN jsonb_build_object('ignored', 'already paid', 'status', v_payment.status);
  END IF;

  IF v_payment.reservation_id IS NOT NULL THEN
    SELECT * INTO v_res
    FROM public.reservations
    WHERE id = v_payment.reservation_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reservation not found for payment.';
    END IF;
  END IF;

  IF _next_status = 'paid' AND v_payment.reservation_id IS NOT NULL THEN
    v_refund_required := coalesce(v_res.deleted, false)
      OR lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed');
  END IF;

  UPDATE public.payments
  SET status = _next_status,
      method = coalesce(_method, method),
      provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
      last_event_id = _event_id,
      last_event = _event,
      requires_refund = v_refund_required,
      refund_required_at = CASE WHEN v_refund_required THEN now() ELSE refund_required_at END
  WHERE id = _payment_id;

  IF _next_status = 'paid' AND v_payment.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET payment_status = CASE WHEN v_refund_required THEN 'Refund Required' ELSE 'Paid' END,
        updated_at = now()
    WHERE id = v_payment.reservation_id;

    IF v_refund_required THEN
      INSERT INTO public.admin_notifications (title, message, type)
      VALUES (
        'Payment requires refund',
        'A payment was received after reservation ' || coalesce(v_res.display_id, v_res.id::text) || ' ended.',
        'Payment'
      );

      IF v_res.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (
          v_res.customer_id,
          'reservation',
          'Payment received after cancellation',
          'We received your payment after this reservation ended. The boutique will review and arrange the refund.',
          jsonb_build_object(
            'reservation_id', v_res.id,
            'display_id', v_res.display_id,
            'payment_status', 'Refund Required'
          )
        );
      END IF;
    ELSIF v_res.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_res.customer_id,
        'reservation',
        'Payment received',
        'Your payment for ' || coalesce(v_res.product_name, 'your item') || ' has been received.',
        jsonb_build_object(
          'reservation_id', v_res.id,
          'display_id', v_res.display_id,
          'payment_status', 'Paid'
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', _next_status,
    'refund_required', v_refund_required
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb)
  TO service_role;

DROP POLICY IF EXISTS "Staff update payments" ON public.payments;
REVOKE UPDATE ON public.payments FROM authenticated, anon, PUBLIC;
