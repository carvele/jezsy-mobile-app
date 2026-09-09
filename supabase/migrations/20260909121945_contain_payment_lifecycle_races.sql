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

CREATE OR REPLACE FUNCTION public.guard_payment_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.provider_ref IS NOT NULL
     AND (
       NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
       OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.amount_centavos IS DISTINCT FROM OLD.amount_centavos
       OR NEW.currency IS DISTINCT FROM OLD.currency
     ) THEN
    RAISE EXCEPTION 'A provider-linked payment attempt is immutable.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_payment_attempt_identity ON public.payments;
CREATE TRIGGER trg_guard_payment_attempt_identity
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_payment_attempt_identity();

REVOKE EXECUTE ON FUNCTION public.guard_payment_attempt_identity()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_payment_status_check
  CHECK (
    payment_status IS NOT NULL
    AND payment_status IN ('Pending', 'Submitted', 'Processing', 'Paid', 'Refund Required', 'Refunded')
  )
  NOT VALID;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_payment_status_check;

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF current_user = 'authenticated'
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
     AND (
       lower(coalesce(OLD.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required')
       OR lower(coalesce(NEW.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required')
     ) THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be reopened or changed.'
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

-- Owners mutate lifecycle state through narrow, row-locking commands. Direct
-- authenticated status/payment updates are rejected by the trigger above.
CREATE OR REPLACE FUNCTION public.transition_reservation_status(
  _reservation_id uuid,
  _expected_status text,
  _next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_old text;
  v_next text;
  v_stored_next text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  v_old := lower(trim(coalesce(v_res.status, '')));
  v_next := lower(trim(coalesce(_next_status, '')));
  IF v_old <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation changed since it was loaded. Refresh and try again.'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF v_old IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_old IN ('pending', 'request approval') AND v_next IN ('to pay', 'confirmed') THEN
    v_stored_next := 'To Pay';
  ELSIF v_old IN ('to pay', 'confirmed', 'approved') AND v_next = 'preparing' THEN
    IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
      RAISE EXCEPTION 'Payment must be confirmed before preparation starts.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_stored_next := 'Preparing';
  ELSIF v_old = 'preparing' AND v_next IN ('ready', 'to pickup') THEN
    v_stored_next := 'Ready';
  ELSE
    RAISE EXCEPTION 'Unsupported reservation transition from % to %.', v_res.status, _next_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  UPDATE public.reservations
  SET status = v_stored_next,
      confirmed_by_id = CASE
        WHEN v_stored_next = 'To Pay' THEN v_actor ELSE confirmed_by_id
      END,
      confirmed_by_name = CASE
        WHEN v_stored_next = 'To Pay' THEN coalesce(v_actor_name, 'Owner') ELSE confirmed_by_name
      END,
      confirmed_at = CASE
        WHEN v_stored_next = 'To Pay' THEN now() ELSE confirmed_at
      END,
      assigned_staff_id = CASE
        WHEN v_stored_next = 'Preparing' THEN v_actor ELSE assigned_staff_id
      END,
      countdown = CASE
        WHEN v_stored_next = 'Preparing' THEN false ELSE countdown
      END,
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'previous_status', _expected_status,
    'status', v_res.status
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.transition_reservation_status(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_reservation_status(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_reservation_as_manager(
  _reservation_id uuid,
  _expected_status text,
  _reason text DEFAULT 'Cancelled by owner'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_res public.reservations%rowtype;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF lower(trim(coalesce(v_res.status, ''))) <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation changed since it was loaded. Refresh and try again.'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(coalesce(v_res.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required')
     OR EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status IN ('awaiting_payment', 'processing', 'paid')
     ) THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.reservations
  SET status = 'Cancelled',
      countdown = false,
      cancellation_reason = left(coalesce(nullif(trim(_reason), ''), 'Cancelled by owner'), 500),
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.review_reservation_receipt(
  _reservation_id uuid,
  _approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_res public.reservations%rowtype;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF lower(coalesce(v_res.status, '')) NOT IN ('to pay', 'confirmed', 'approved') THEN
    RAISE EXCEPTION 'Only a reservation awaiting payment can have its receipt reviewed.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF lower(coalesce(v_res.payment_status, '')) NOT IN ('submitted', 'processing') THEN
    RAISE EXCEPTION 'This receipt is no longer awaiting review.' USING ERRCODE = 'check_violation';
  END IF;

  IF _approve THEN
    UPDATE public.reservations
    SET payment_status = 'Paid',
        status = 'Preparing',
        assigned_staff_id = v_actor,
        countdown = false,
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  ELSE
    UPDATE public.reservations
    SET payment_status = 'Pending',
        receipt_url = NULL,
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'approved', _approve,
    'status', v_res.status,
    'payment_status', v_res.payment_status
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.review_reservation_receipt(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_reservation_receipt(uuid, boolean)
  TO authenticated;

-- Existing balance and reschedule functions are intentionally retained as
-- implementation details. Dashboard callers use these owner-only wrappers.
REVOKE EXECUTE ON FUNCTION public.settle_reservation_balance(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.settle_reservation_balance(_reservation_id, _method);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_reservation_balance(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reservation_balance(uuid, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_reschedule(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_reschedule_as_manager(
  _reservation_id uuid,
  _approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.resolve_reschedule(_reservation_id, _approve);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_reschedule_as_manager(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_reschedule_as_manager(uuid, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_reservation_handover(
  _reservation_id uuid,
  _method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_res public.reservations%rowtype;
  v_settlement jsonb;
  v_outstanding numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF lower(coalesce(v_res.status, '')) NOT IN ('ready', 'to pickup', 'fitting') THEN
    RAISE EXCEPTION 'Only an item ready for pickup can be handed over.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before handover.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_outstanding := coalesce(v_res.rental_price, 0) - coalesce(v_res.deposit, 0);
  IF v_outstanding > 0 AND v_res.balance_settled_at IS NULL THEN
    v_settlement := public.settle_reservation_balance(_reservation_id, _method);
  END IF;

  UPDATE public.reservations
  SET status = 'Completed', updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'status', v_res.status,
    'settled_amount', coalesce((v_settlement->>'settled_amount')::numeric, 0)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_reservation_handover(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_reservation_handover(uuid, text)
  TO authenticated;

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
  v_other_paid boolean := false;
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
  IF v_payment.status = 'paid' AND _next_status = 'paid' THEN
    RETURN jsonb_build_object('duplicate', true, 'status', v_payment.status);
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
    SELECT EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.reservation_id = v_payment.reservation_id
        AND p.id <> v_payment.id
        AND p.status = 'paid'
    ) INTO v_other_paid;

    v_refund_required := coalesce(v_res.deleted, false)
      OR lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed')
      OR v_other_paid;
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
        CASE
          WHEN v_other_paid THEN
            'An additional payment was received for reservation ' || coalesce(v_res.display_id, v_res.id::text) || '.'
          ELSE
            'A payment was received after reservation ' || coalesce(v_res.display_id, v_res.id::text) || ' ended.'
        END,
        'Payment'
      );

      IF v_res.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (
          v_res.customer_id,
          'reservation',
          'Payment requires refund review',
          CASE
            WHEN v_other_paid THEN
              'We received an additional payment for this reservation. The boutique will review and arrange the refund.'
            ELSE
              'We received your payment after this reservation ended. The boutique will review and arrange the refund.'
          END,
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
