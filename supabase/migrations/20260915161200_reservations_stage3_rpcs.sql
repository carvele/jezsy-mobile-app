-- ─────────────────────────────────────────────────────────────────────────────
-- 20260915161200_reservations_stage3_rpcs.sql
--
-- Reservations Stage 3 database deliverables:
--
--   A-1. Refund disbursement columns on payments
--   A-2. mark_reservation_refund_disbursed  (R-02 canonical refund writer)
--   A-3. reschedule_reservation_as_manager  (R-04 + R-05 canonical reschedule)
--   A-4. Harden guard_reservation_financial_state with Completed-transition
--        invariant  (R-03 defense in depth)
--
-- All changes are idempotent.  Rollback: see companion .sql.rollback file.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A-1. Refund disbursement columns on payments ──────────────────────────────

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_disbursed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS refund_disbursement_method   text,
  ADD COLUMN IF NOT EXISTS refund_reference_number      text,
  ADD COLUMN IF NOT EXISTS refund_disbursed_by          uuid
    REFERENCES auth.users(id);

-- ── A-2. mark_reservation_refund_disbursed ────────────────────────────────────
--
-- Privileged-tier RPC: Admin / Owner only.
-- Locks the cancelled reservation and all qualifying payment rows, sums the
-- total refund amount server-side, marks payments refund-disbursed (does NOT
-- change payments.status away from 'paid' — that would corrupt Gross Cash
-- Collected), updates reservation.payment_status, and writes one audit event.

CREATE OR REPLACE FUNCTION public.mark_reservation_refund_disbursed(
  _reservation_id       uuid,
  _disbursement_method  text,
  _reference_number     text,
  _notes                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id      uuid;
  v_reservation   public.reservations%rowtype;
  v_total_centavos bigint := 0;
  v_payment       record;
BEGIN
  -- Authorization: admin or owner only.
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Refund disbursement requires admin or owner authorization.'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation.
  IF _disbursement_method IS NULL OR trim(_disbursement_method) = '' THEN
    RAISE EXCEPTION 'Disbursement method is required.';
  END IF;
  IF _reference_number IS NULL OR trim(_reference_number) = '' THEN
    RAISE EXCEPTION 'Reference number is required.';
  END IF;

  -- Lock reservation row.
  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Must be Cancelled.
  IF lower(coalesce(v_reservation.status, '')) <> 'cancelled' THEN
    RAISE EXCEPTION 'Refund disbursement only applies to cancelled reservations.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotency: if already fully refunded, return graceful success.
  IF lower(coalesce(v_reservation.payment_status, '')) = 'refunded'
    AND NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE reservation_id = _reservation_id
        AND status = 'paid'
        AND coalesce(requires_refund, false) = true
    )
  THEN
    RETURN jsonb_build_object(
      'reservation_id', _reservation_id,
      'status', 'already_refunded',
      'total_refunded_centavos', 0
    );
  END IF;

  -- Lock and aggregate all qualifying payment rows.
  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = _reservation_id
      AND status = 'paid'
      AND coalesce(requires_refund, false) = true
    ORDER BY id
    FOR UPDATE
  LOOP
    v_total_centavos := v_total_centavos + v_payment.amount_centavos;
  END LOOP;

  IF v_total_centavos = 0 THEN
    RAISE EXCEPTION 'No unrefunded payment rows found for this reservation.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Mutate payment rows: mark disbursed. DO NOT change status away from 'paid'.
  UPDATE public.payments
  SET
    requires_refund             = false,
    refund_required_at          = NULL,
    refund_disbursed_at         = now(),
    refund_disbursement_method  = trim(_disbursement_method),
    refund_reference_number     = trim(_reference_number),
    refund_disbursed_by         = v_actor_id,
    metadata                    = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('refund_notes', _notes)
  WHERE reservation_id = _reservation_id
    AND status = 'paid'
    AND coalesce(requires_refund, false) = true;

  -- Update reservation financial substate.
  UPDATE public.reservations
  SET
    payment_status = 'Refunded',
    updated_at     = now()
  WHERE id = _reservation_id;

  -- Audit event.
  INSERT INTO public.logs (
    user_id, action, target_type, target_id, details
  ) VALUES (
    v_actor_id,
    'Disbursed reservation refund',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'display_id',            v_reservation.display_id,
      'total_refunded_pesos',  round(v_total_centavos::numeric / 100, 2),
      'disbursement_method',   trim(_disbursement_method),
      'reference_number',      trim(_reference_number),
      'notes',                 _notes
    )
  );

  RETURN jsonb_build_object(
    'reservation_id',          _reservation_id,
    'status',                  'refunded',
    'total_refunded_centavos', v_total_centavos
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_reservation_refund_disbursed(uuid, text, text, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_reservation_refund_disbursed(uuid, text, text, text)
  FROM anon;

-- ── A-3. reschedule_reservation_as_manager ────────────────────────────────────
--
-- Operational-tier RPC: Staff / Admin / Owner.
-- Row-locks reservation, asserts expected status (optimistic concurrency),
-- acquires transaction-scoped capacity advisory lock on the target date,
-- delegates slot validation to assert_bookable_slot (excluding self),
-- recomputes payment deadline, mutates, and writes audit event.

CREATE OR REPLACE FUNCTION public.reschedule_reservation_as_manager(
  _reservation_id      uuid,
  _expected_status     text,
  _new_date            date,
  _new_appointment_time time,
  _reason              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id        uuid;
  v_reservation     public.reservations%rowtype;
  v_new_appointment timestamptz;
  v_old_date_key    text;
  v_new_date_key    text;
BEGIN
  -- Authorization: operational tier.
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation operation requires staff, admin, or owner authorization.'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation.
  IF _new_date IS NULL THEN
    RAISE EXCEPTION 'New date is required.';
  END IF;
  IF _new_appointment_time IS NULL THEN
    RAISE EXCEPTION 'New appointment time is required.';
  END IF;

  -- Row lock.
  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Optimistic concurrency: status must match caller's expectation.
  IF lower(coalesce(v_reservation.status, '')) <> lower(coalesce(_expected_status, '')) THEN
    RAISE EXCEPTION 'Reservation status has changed. Expected "%" but found "%".',
      _expected_status, v_reservation.status
      USING ERRCODE = '40001'; -- serialization_failure
  END IF;

  -- Must not be terminal.
  IF lower(coalesce(v_reservation.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot reschedule a % reservation.', v_reservation.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Build Manila timestamptz for the new appointment.
  v_new_appointment := (_new_date + _new_appointment_time)
    AT TIME ZONE 'Asia/Manila';

  -- Capacity advisory lock: serialize concurrent bookings on the target date.
  -- If moving between dates, lock both in deterministic order to prevent deadlock.
  v_new_date_key := 'reservation-capacity:' || _new_date::text;
  v_old_date_key := 'reservation-capacity:'
    || coalesce(
         (v_reservation.date AT TIME ZONE 'Asia/Manila')::date,
         _new_date
       )::text;

  IF v_old_date_key <> v_new_date_key THEN
    -- Lock both keys in deterministic order.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(least(v_old_date_key, v_new_date_key), 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(greatest(v_old_date_key, v_new_date_key), 0)
    );
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_new_date_key, 0)
    );
  END IF;

  -- Server-authoritative slot and capacity validation (excluding this reservation).
  PERFORM public.assert_bookable_slot(
    _date               => _new_date,
    _appointment        => v_new_appointment,
    _check_capacity     => true,
    _exclude_reservation => _reservation_id
  );

  -- Recompute payment deadline if still awaiting payment.
  -- Only recompute when To Pay and payment is genuinely unpaid.
  UPDATE public.reservations
  SET
    date             = (_new_date || ' 00:00:00 Asia/Manila')::timestamptz,
    appointment_time = v_new_appointment,
    countdown        = true,
    reschedule_requested_at = NULL,
    payment_due_at   = CASE
      WHEN lower(coalesce(status, '')) = 'to pay'
       AND lower(coalesce(payment_status, '')) = 'pending'
      THEN least(
        now() + interval '24 hours',
        v_new_appointment - interval '1 hour'
      )
      ELSE payment_due_at
    END,
    updated_at       = now()
  WHERE id = _reservation_id;

  -- Audit event.
  INSERT INTO public.logs (
    user_id, action, target_type, target_id, details
  ) VALUES (
    v_actor_id,
    'Rescheduled reservation as manager',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'display_id',          v_reservation.display_id,
      'previous_date',       (v_reservation.date AT TIME ZONE 'Asia/Manila')::date,
      'previous_time',       (v_reservation.appointment_time AT TIME ZONE 'Asia/Manila')::time,
      'new_date',            _new_date,
      'new_appointment_time', _new_appointment_time,
      'reason',              _reason
    )
  );

  RETURN jsonb_build_object(
    'reservation_id',    _reservation_id,
    'date',              _new_date,
    'appointment_time',  _new_appointment_time
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reschedule_reservation_as_manager(uuid, text, date, time, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reschedule_reservation_as_manager(uuid, text, date, time, text)
  FROM anon;

-- ── A-4. Harden guard_reservation_financial_state ────────────────────────────
--
-- The existing trigger already blocks:
--   - authenticated direct status/payment_status writes
--   - un-paying a paid reservation
--   - cancelling a paid reservation
--   - reopening a terminal reservation
--   - preparing without payment
--
-- Add the Completed-transition invariant (R-03 defense in depth):
--   ANY update that sets status = 'Completed' must satisfy:
--     - previous status IN ('Ready', 'To Pickup', 'Fitting', 'Active')
--     - NEW.payment_status = 'Paid'
--     - if payment_type = 'Deposit': balance_settled_at IS NOT NULL
--
-- The trigger and its attachment are retained unchanged; only the function body
-- is replaced via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  -- Block direct authenticated client status/payment_status writes.
  -- SECURITY DEFINER RPCs run as the function owner (postgres), not as
  -- 'authenticated', so legitimate command RPCs are not affected here.
  IF current_user = 'authenticated'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     ) THEN
    RAISE EXCEPTION 'Use an authorized reservation command to change lifecycle or payment state.'
      USING ERRCODE = '42501';
  END IF;

  -- A paid reservation cannot be reverted to unpaid.
  IF lower(coalesce(OLD.payment_status, '')) = 'paid'
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'A paid reservation cannot be marked unpaid.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cancelling a paid reservation must go through the refund path.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) = 'cancelled'
     AND (
       lower(coalesce(OLD.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required')
       OR lower(coalesce(NEW.payment_status, '')) IN ('paid', 'submitted', 'processing', 'refund required')
     ) THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Terminal reservations cannot be reopened or changed.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be reopened or changed.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Payment must be confirmed before moving to preparing/ready states.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) IN ('preparing', 'ready', 'to pickup')
     AND lower(coalesce(NEW.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before preparing this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- R-03 completion invariant: any transition to Completed must have verified payment.
  -- Guards against direct SQL updates or rogue scripts bypassing the handover RPC.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) = 'completed' THEN

    -- Previous status must be a Ready-equivalent state.
    IF lower(coalesce(OLD.status, '')) NOT IN ('ready', 'to pickup', 'fitting', 'active') THEN
      RAISE EXCEPTION 'Reservation can only be completed from a Ready state.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Payment must be verified paid.
    IF lower(coalesce(NEW.payment_status, '')) <> 'paid' THEN
      RAISE EXCEPTION 'Reservation cannot be completed without confirmed payment.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Deposit reservations require balance settlement before completion.
    IF lower(coalesce(NEW.payment_type, '')) = 'deposit'
       AND NEW.balance_settled_at IS NULL THEN
      RAISE EXCEPTION 'Deposit reservation requires balance settlement before completion.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger already exists; no need to recreate it.
-- Revoke from anon in case it was granted elsewhere.
REVOKE EXECUTE ON FUNCTION public.guard_reservation_financial_state()
  FROM PUBLIC, anon, authenticated;
