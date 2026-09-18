-- ============================================================================
-- Migration: 20260918210000_allow_cancelled_reservation_payment_status.sql
-- Description: Align reservation payment_status with Cancelled lifecycle state.
--   1. Widen reservations_payment_status_check to allow 'Cancelled'.
--   2. Update guard_reservation_financial_state() to permit Cancelled payment_status
--      while strictly prohibiting settled funds from being marked Cancelled.
--   3. Update cancel_customer_reservation() to set payment_status = 'Cancelled'.
--   4. Update expire_all_stale_reservations() to set payment_status = 'Cancelled'.
--   5. Update cancel_reservation_as_manager() to conditionally set payment_status:
--      unpaid -> Cancelled; paid -> Refund Required; preserve Refund Required / Refunded.
--   6. Update review_reservation_receipt() on rejection to ensure countdown = true
--      and extended deadline so customer can cleanly upload a new receipt.
--   7. Repair existing legacy unpaid cancelled reservations (Pending -> Cancelled).
-- ============================================================================

-- 1. Widen check constraint to allow 'Cancelled'
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_payment_status_check
  CHECK (
    payment_status IS NOT NULL
    AND payment_status IN ('Pending', 'Submitted', 'Processing', 'Paid', 'Refund Required', 'Refunded', 'Cancelled')
  )
  NOT VALID;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_payment_status_check;

-- 2. Update financial guard trigger function
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

  -- Settled or refundable funds can never be marked unpaid or cancelled
  IF lower(coalesce(OLD.payment_status, '')) IN ('paid', 'refund required')
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'Settled or refundable payment cannot be marked unpaid or cancelled.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A cancelled payment status cannot be applied if settled payments exist
  IF lower(coalesce(NEW.payment_status, '')) = 'cancelled'
     AND EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = NEW.id
         AND p.status = 'paid'
         AND p.refund_disbursed_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Cannot cancel payment obligation: settled payments exist for this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Operational status = Cancelled requires a consistent payment workflow state
  IF lower(coalesce(NEW.status, '')) = 'cancelled'
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('cancelled', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'A cancelled reservation must have payment status of Cancelled, Refund Required, or Refunded.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Terminal reservations cannot be reopened
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be reopened or changed.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Fulfillment requires paid status
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) IN ('preparing', 'ready', 'to pickup')
     AND lower(coalesce(NEW.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before preparing this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_reservation_financial_state() FROM PUBLIC, anon, authenticated;

-- 3. Hardened RPC: cancel_customer_reservation
CREATE OR REPLACE FUNCTION public.cancel_customer_reservation(
  _reservation_id uuid,
  _reason text DEFAULT 'Cancelled by customer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_status text;
  v_pstatus text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_res.customer_id <> v_actor THEN
    RAISE EXCEPTION 'You do not own this reservation.' USING ERRCODE = '42501';
  END IF;

  v_status := pg_catalog.lower(TRIM(COALESCE(v_res.status, '')));
  v_pstatus := pg_catalog.lower(TRIM(COALESCE(v_res.payment_status, '')));

  -- Idempotency check: if already cancelled, return success
  IF v_status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'already_cancelled', true);
  END IF;

  IF v_status NOT IN ('to pay', 'confirmed') THEN
    RAISE EXCEPTION 'Only reservations awaiting payment can be cancelled.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_pstatus IN ('paid', 'deposit paid', 'partially paid', 'submitted', 'processing', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'A reservation with payment activity cannot be cancelled directly.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.reservation_id = _reservation_id
      AND pg_catalog.lower(TRIM(COALESCE(p.status, ''))) IN ('paid', 'processing')
  ) THEN
    RAISE EXCEPTION 'Payment in progress; cannot cancel.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.reservations
  SET status = 'Cancelled',
      payment_status = 'Cancelled',
      countdown = false,
      cancellation_reason = COALESCE(NULLIF(TRIM(_reason), ''), 'Cancelled by customer'),
      updated_at = pg_catalog.now()
  WHERE id = _reservation_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'reservation_id', _reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_customer_reservation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_customer_reservation(uuid, text) TO authenticated;

-- 4. Expire stale unpaid reservations
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
        payment_status = 'Cancelled',
        countdown = false,
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

-- 5. Manager cancellation with conditional financial resolution
CREATE OR REPLACE FUNCTION public.cancel_reservation_as_manager(
  _reservation_id uuid,
  _expected_status text,
  _reason text DEFAULT 'Cancelled by owner'::text
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
  v_next_payment_status text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
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

  -- Determine payment status transition based on financial reality
  IF lower(coalesce(v_res.payment_status, '')) = 'refunded' THEN
    v_next_payment_status := 'Refunded';
  ELSIF lower(coalesce(v_res.payment_status, '')) = 'refund required' THEN
    v_next_payment_status := 'Refund Required';
  ELSIF lower(coalesce(v_res.payment_status, '')) = 'paid'
     OR EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status = 'paid'
         AND p.refund_disbursed_at IS NULL
     ) THEN
    -- Real money was collected: route to refund queue
    v_next_payment_status := 'Refund Required';
    UPDATE public.payments
    SET requires_refund = true,
        refund_required_at = coalesce(refund_required_at, now()),
        updated_at = now()
    WHERE reservation_id = _reservation_id
      AND status = 'paid'
      AND refund_disbursed_at IS NULL;
  ELSIF EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status IN ('awaiting_payment', 'processing')
     ) THEN
    RAISE EXCEPTION 'Payment is currently in progress. Wait for completion or expire the session before cancelling.'
      USING ERRCODE = 'check_violation';
  ELSE
    -- Genuinely unpaid (Pending or Submitted manual receipt without settled funds)
    v_next_payment_status := 'Cancelled';
    -- If a manual payment submission was awaiting review, mark it rejected as cancelled
    IF v_res.deposit_submission_id IS NOT NULL THEN
      UPDATE public.manual_payment_submissions
      SET status = 'rejected',
          rejection_reason = 'reservation_cancelled',
          staff_note = left(coalesce(nullif(trim(_reason), ''), 'Reservation cancelled by staff'), 500),
          reviewed_by = v_actor,
          reviewed_by_name = coalesce(v_actor_name, 'Staff'),
          reviewed_at = now(),
          updated_at = now()
      WHERE id = v_res.deposit_submission_id
        AND status = 'submitted';
    END IF;
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  UPDATE public.reservations
  SET status = 'Cancelled',
      payment_status = v_next_payment_status,
      countdown = false,
      cancellation_reason = left(coalesce(nullif(trim(_reason), ''), 'Cancelled by owner'), 500),
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    'Cancelled reservation',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status', _expected_status,
      'payment_status', v_res.payment_status,
      'reason', v_res.cancellation_reason
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'status', v_res.status,
    'payment_status', v_res.payment_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) TO authenticated;

-- 6. Receipt review: ensure countdown = true on rejection so retry timer runs and customer can re-upload
CREATE OR REPLACE FUNCTION public.review_reservation_receipt(
  _reservation_id uuid,
  _approve boolean,
  _reason_code text DEFAULT NULL,
  _staff_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_amount_centavos bigint;
  v_purpose text;
  v_retry_minutes integer;
  v_reason_text text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND _reason_code IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reject a receipt.';
  END IF;
  IF _reason_code IS NOT NULL AND _reason_code NOT IN (
    'unreadable_receipt', 'wrong_amount', 'invalid_reference', 'wrong_account',
    'duplicate_receipt', 'suspected_fraud', 'other'
  ) THEN
    RAISE EXCEPTION 'Unrecognized rejection reason.';
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

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  IF _approve THEN
    v_amount_centavos := round(coalesce(v_res.deposit, 0) * 100)::bigint;
    v_purpose := CASE
      WHEN lower(coalesce(v_res.payment_type, '')) = 'full' THEN 'full_payment'
      ELSE 'initial_deposit'
    END;
    IF v_amount_centavos <= 0 THEN
      RAISE EXCEPTION 'The reservation has no payable amount.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.reservation_id = v_res.id
        AND p.status = 'paid'
        AND coalesce(p.requires_refund, false) = false
        AND p.purpose IN ('initial_deposit', 'full_payment')
    ) THEN
      RAISE EXCEPTION 'The initial reservation payment is already recorded.'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.payments (
      user_id, reservation_id, provider, provider_ref, amount_centavos,
      currency, status, method, purpose, receipt_url, reference_number,
      metadata, attempt_started_at, created_at
    ) VALUES (
      v_res.customer_id, v_res.id, 'manual', 'receipt:' || v_res.id::text,
      v_amount_centavos, 'PHP', 'paid', coalesce(v_res.manual_payment_method, 'transfer'),
      v_purpose, v_res.receipt_url, v_res.manual_reference_number,
      jsonb_build_object('submission_id', v_res.deposit_submission_id, 'amount_claimed', v_res.manual_amount_claimed),
      now(), now()
    );

    IF v_res.deposit_submission_id IS NOT NULL THEN
      UPDATE public.manual_payment_submissions
      SET status = 'approved',
          reviewed_by = v_actor,
          reviewed_by_name = coalesce(v_actor_name, 'Staff'),
          reviewed_at = now(),
          updated_at = now()
      WHERE id = v_res.deposit_submission_id;
    END IF;

    UPDATE public.reservations
    SET payment_status = 'Paid',
        status = 'Preparing',
        assigned_staff_id = v_actor,
        countdown = false,
        balance_settled_at = CASE
          WHEN v_amount_centavos >= round(coalesce(v_res.rental_price, 0) * 100)::bigint
            THEN coalesce(balance_settled_at, now())
          ELSE balance_settled_at
        END,
        balance_settled_by = CASE
          WHEN v_amount_centavos >= round(coalesce(v_res.rental_price, 0) * 100)::bigint THEN v_actor
          ELSE balance_settled_by
        END,
        balance_settled_by_name = CASE
          WHEN v_amount_centavos >= round(coalesce(v_res.rental_price, 0) * 100)::bigint
            THEN coalesce(v_actor_name, 'Staff')
          ELSE balance_settled_by_name
        END,
        balance_settled_method = CASE
          WHEN v_amount_centavos >= round(coalesce(v_res.rental_price, 0) * 100)::bigint THEN 'transfer'
          ELSE balance_settled_method
        END,
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  ELSE
    v_retry_minutes := coalesce(
      (SELECT (value->>'retry_minutes')::integer FROM public.settings WHERE key = 'reservationPaymentWindow'),
      60
    );

    IF v_res.deposit_submission_id IS NOT NULL THEN
      UPDATE public.manual_payment_submissions
      SET status = 'rejected',
          rejection_reason = _reason_code,
          staff_note = _staff_note,
          reviewed_by = v_actor,
          reviewed_by_name = coalesce(v_actor_name, 'Staff'),
          reviewed_at = now(),
          updated_at = now()
      WHERE id = v_res.deposit_submission_id;
    END IF;

    UPDATE public.reservations
    SET payment_status = 'Pending',
        receipt_url = NULL,
        countdown = true,
        payment_due_at = now() + make_interval(mins => v_retry_minutes),
        last_receipt_rejection_reason = _reason_code,
        last_receipt_rejected_at = now(),
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;

    v_reason_text := CASE _reason_code
      WHEN 'unreadable_receipt' THEN 'The receipt image could not be verified.'
      WHEN 'wrong_amount' THEN 'The amount shown does not match the required payment.'
      WHEN 'invalid_reference' THEN 'The payment reference could not be verified.'
      WHEN 'suspected_fraud' THEN 'We couldn''t verify this payment. Please contact the boutique for assistance.'
      WHEN 'duplicate_receipt' THEN 'This receipt has already been submitted.'
      ELSE 'We couldn''t verify your payment proof.'
    END;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Payment proof needs attention',
      _body    => v_reason_text || ' Please resubmit payment for ' || coalesce(v_res.product_name, 'your item') || ' before your new deadline.',
      _type    => 'reservation',
      _data    => jsonb_build_object(
        'reservation_id', _reservation_id,
        'action', 'reupload_receipt'
      )
    );
  END IF;

  RETURN to_jsonb(v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) TO authenticated;

-- 7. Data repair: Update verified legacy unpaid cancelled reservations from 'Pending' to 'Cancelled'
UPDATE public.reservations
SET payment_status = 'Cancelled',
    updated_at = now()
WHERE status = 'Cancelled'
  AND payment_status = 'Pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.reservation_id = reservations.id
      AND p.status = 'paid'
  );
