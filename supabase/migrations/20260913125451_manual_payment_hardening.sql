-- Manual payment remediation (DB layer). Confirmed gaps from the receipt-
-- handling audit: (1) customers are never shown WHERE to send a manual
-- transfer before uploading proof, (2) receipts carry no structured
-- method/amount/reference -- staff judge a bare image with no context,
-- (3) rejection has no reason code or fraud distinction, (4) a receipt
-- rejected near the deadline previously got no fresh retry window (fixed
-- separately in 20260913124520_configurable_payment_windows.sql).
--
-- Deliberately "latest submission only" semantics: manual_* columns below
-- represent the CURRENT/latest manual submission, same as the existing
-- receipt_url column already does. A full proof-by-proof forensic history
-- would need a separate submission table -- not built here, to avoid
-- half-building both a wide-row and a history table for the same data.

-- ── 1. Payment instructions (structured, staff-only writes via existing
-- settings RLS: admin/owner write, world read -- not secrets, matches the
-- reservationPaymentWindow row's convention). Every *_enabled flag starts
-- false and every account field starts blank: an unconfigured method must
-- never appear "enabled" with empty details.
INSERT INTO public.settings (key, value)
VALUES (
  'paymentInstructions',
  jsonb_build_object(
    'manual_payment_enabled', false,
    'gcash_enabled', false,
    'gcash_account_name', '',
    'gcash_number', '',
    'bank_transfer_enabled', false,
    'bank_name', '',
    'bank_account_name', '',
    'bank_account_number', '',
    'manual_payment_instructions', '',
    'manual_payment_reference_instructions', ''
  )
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Structured manual-submission metadata + retry/rejection tracking.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS manual_payment_method text,
  ADD COLUMN IF NOT EXISTS manual_amount_claimed numeric,
  ADD COLUMN IF NOT EXISTS manual_reference_number text,
  ADD COLUMN IF NOT EXISTS manual_receipt_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_receipt_rejection_reason text,
  ADD COLUMN IF NOT EXISTS last_receipt_rejected_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_manual_payment_method_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_manual_payment_method_check
      CHECK (manual_payment_method IS NULL OR manual_payment_method IN ('gcash', 'bank_transfer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_manual_amount_claimed_positive') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_manual_amount_claimed_positive
      CHECK (manual_amount_claimed IS NULL OR manual_amount_claimed > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_last_receipt_rejection_reason_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_last_receipt_rejection_reason_check
      CHECK (last_receipt_rejection_reason IS NULL OR last_receipt_rejection_reason IN (
        'unreadable_receipt', 'wrong_amount', 'invalid_reference', 'wrong_account',
        'duplicate_receipt', 'suspected_fraud', 'other'
      ));
  END IF;
END $$;

-- ── 3. Loosen the payment-hold-on-cancel guard from "any receipt activity"
-- to "confirmed money" only. Both the RPC's own check and the independent
-- trigger previously blocked cancellation whenever payment_status was
-- 'Submitted' or 'Processing' -- i.e. exactly the state a suspected-fraud
-- cancellation needs to act in, since fraud is caught DURING review, never
-- after payment is already confirmed 'Paid'. 'Submitted'/'Processing' is an
-- unverified customer CLAIM, not confirmed money received -- cancelling
-- one does not create an owed-refund situation the way cancelling a 'Paid'
-- or 'Refund Required' reservation would. Narrowing to those two statuses
-- is the semantically correct definition of what this guard protects, not
-- just a workaround: it was blocking legitimate cancellation of a
-- reservation with a merely-pending, never-verified receipt before this
-- fix too. The payments-table EXISTS check (an in-flight PayMongo attempt)
-- is left unchanged -- a live gateway checkout can complete payment at any
-- moment, so that risk is real regardless of receipt review state.
CREATE OR REPLACE FUNCTION public.cancel_reservation_as_manager(_reservation_id uuid, _expected_status text, _reason text DEFAULT 'Cancelled by owner'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
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
  IF lower(coalesce(v_res.payment_status, '')) IN ('paid', 'refund required')
     OR EXISTS (
       SELECT 1 FROM public.payments p
       WHERE p.reservation_id = _reservation_id
         AND p.status IN ('awaiting_payment', 'processing', 'paid')
     ) THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  UPDATE public.reservations
  SET status = 'Cancelled',
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
    jsonb_build_object('previous_status', _expected_status, 'reason', v_res.cancellation_reason)
  );

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
 RETURNS trigger
 LANGUAGE plpgsql
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
       lower(coalesce(OLD.payment_status, '')) IN ('paid', 'refund required')
       OR lower(coalesce(NEW.payment_status, '')) IN ('paid', 'refund required')
     ) THEN
    RAISE EXCEPTION 'Resolve or refund the payment before cancelling this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.status, '')) IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be reopened or changed.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) IN ('preparing', 'ready', 'to pickup')
     AND lower(coalesce(NEW.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be confirmed before preparing this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. Manual submission now captures structured metadata, increments the
-- attempt counter, and refuses a submission past the server-authoritative
-- deadline (previously only gated on status, not on payment_due_at --
-- a real, narrow race: the cron might not have run yet even though the
-- window had already closed).
--
-- CREATE OR REPLACE only replaces a function whose argument list matches
-- exactly -- adding parameters here would otherwise leave the old 2-arg
-- signature coexisting as a separate overload (silently stale, or
-- ambiguous once defaults are involved). Drop it explicitly first.
DROP FUNCTION IF EXISTS public.submit_reservation_receipt(uuid, text);

CREATE OR REPLACE FUNCTION public.submit_reservation_receipt(
  _reservation_id uuid,
  _receipt_path text,
  _method text,
  _amount_claimed numeric,
  _reference_number text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_reservation public.reservations%rowtype;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF _receipt_path IS NULL OR _receipt_path = '' THEN RAISE EXCEPTION 'A receipt is required.'; END IF;
  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;
  IF _method IS NULL OR _method NOT IN ('gcash', 'bank_transfer') THEN
    RAISE EXCEPTION 'A valid payment method is required.';
  END IF;
  IF _amount_claimed IS NULL OR _amount_claimed <= 0 THEN
    RAISE EXCEPTION 'The amount sent is required.';
  END IF;
  IF nullif(trim(coalesce(_reference_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A payment reference number is required.';
  END IF;

  SELECT * INTO v_reservation FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
  IF v_reservation.customer_id <> v_user_id THEN RAISE EXCEPTION 'Not your reservation.'; END IF;
  IF lower(COALESCE(v_reservation.payment_status, '')) = 'paid' THEN
    RAISE EXCEPTION 'This reservation is already paid.';
  END IF;
  IF NOT public.is_awaiting_payment_status(v_reservation.status) THEN
    RAISE EXCEPTION 'This reservation is not awaiting payment yet.';
  END IF;
  IF v_reservation.payment_due_at IS NOT NULL AND v_reservation.payment_due_at < now() THEN
    RAISE EXCEPTION 'The payment window has closed. Please contact the boutique.';
  END IF;

  UPDATE public.reservations
  SET receipt_url = _receipt_path,
      payment_status = 'Submitted',
      manual_payment_method = _method,
      manual_amount_claimed = _amount_claimed,
      manual_reference_number = trim(_reference_number),
      manual_receipt_attempt_count = manual_receipt_attempt_count + 1
  WHERE id = _reservation_id RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_reservation_receipt(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_reservation_receipt(uuid, text, text, numeric, text) TO authenticated;

-- ── 5. Review gains a required reason code on reject, and records it for
-- both the customer-facing history and the next review's context.
-- Same overload hazard as above -- drop the old 2-arg signature first so
-- a 2-arg call can't become ambiguous against the new defaulted params.
DROP FUNCTION IF EXISTS public.review_reservation_receipt(uuid, boolean);

CREATE OR REPLACE FUNCTION public.review_reservation_receipt(
  _reservation_id uuid,
  _approve boolean,
  _reason_code text DEFAULT NULL::text,
  _staff_note text DEFAULT NULL::text
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
  v_amount_centavos bigint;
  v_purpose text;
  v_retry_minutes integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
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

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
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
      currency, status, method, purpose, attempt_started_at
    ) VALUES (
      v_res.customer_id, v_res.id, 'manual', 'receipt:' || v_res.id::text,
      v_amount_centavos, 'PHP', 'paid', 'transfer', v_purpose, now()
    );

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
            THEN coalesce(v_actor_name, 'Owner')
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

    UPDATE public.reservations
    SET payment_status = 'Pending',
        receipt_url = NULL,
        payment_due_at = GREATEST(coalesce(payment_due_at, now()), now() + make_interval(mins => v_retry_minutes)),
        last_receipt_rejection_reason = _reason_code,
        last_receipt_rejected_at = now(),
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  END IF;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    CASE WHEN _approve THEN 'Approved reservation receipt' ELSE 'Rejected reservation receipt' END,
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'approved', _approve,
      'status', v_res.status,
      'payment_status', v_res.payment_status,
      'payment_purpose', CASE WHEN _approve THEN v_purpose ELSE NULL END,
      'reason_code', CASE WHEN _approve THEN NULL ELSE _reason_code END,
      'staff_note', CASE WHEN _approve THEN NULL ELSE _staff_note END,
      'payment_due_at', CASE WHEN _approve THEN NULL ELSE v_res.payment_due_at END
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'approved', _approve,
    'status', v_res.status,
    'payment_status', v_res.payment_status,
    'payment_due_at', v_res.payment_due_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) TO authenticated;

-- ── 6. Suspected-fraud cancellation. A thin wrapper, not a hand-edit: all
-- financial/inventory guards stay owned by cancel_reservation_as_manager.
-- This function only supplies a structured reason and requires the
-- receipt to actually be under review (payment_status submitted/processing)
-- -- a plain "no reason" staff cancel should still go through
-- cancel_reservation_as_manager directly, unchanged.
CREATE OR REPLACE FUNCTION public.cancel_reservation_for_fraud(
  _reservation_id uuid,
  _expected_status text,
  _reason_code text,
  _staff_note text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_res public.reservations%rowtype;
  v_reason text;
BEGIN
  IF _reason_code IS NULL OR _reason_code NOT IN (
    'unreadable_receipt', 'wrong_amount', 'invalid_reference', 'wrong_account',
    'duplicate_receipt', 'suspected_fraud', 'other'
  ) THEN
    RAISE EXCEPTION 'A recognized reason is required to cancel for suspected fraud.';
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id AND coalesce(deleted, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF lower(coalesce(v_res.payment_status, '')) NOT IN ('submitted', 'processing') THEN
    RAISE EXCEPTION 'This action is for a receipt currently under review.' USING ERRCODE = 'check_violation';
  END IF;

  v_reason := 'Suspected fraud (' || _reason_code || ')'
    || CASE WHEN nullif(trim(coalesce(_staff_note, '')), '') IS NOT NULL THEN ': ' || trim(_staff_note) ELSE '' END;

  RETURN public.cancel_reservation_as_manager(_reservation_id, _expected_status, v_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_reservation_for_fraud(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_for_fraud(uuid, text, text, text) TO authenticated;

-- ── 7. Duplicate-reference lookup -- a warning surface for staff, never an
-- automatic verdict. Matches on normalized reference number across OTHER
-- reservations that already have a confirmed 'Paid' manual payment.
CREATE OR REPLACE FUNCTION public.find_duplicate_payment_reference(
  _reference_number text,
  _exclude_reservation_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(reservation_id uuid, display_id text, customer_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.display_id, r.customer_name
  FROM public.reservations r
  WHERE coalesce(r.deleted, false) = false
    AND (_exclude_reservation_id IS NULL OR r.id <> _exclude_reservation_id)
    AND lower(trim(r.manual_reference_number)) = lower(trim(_reference_number))
    AND lower(coalesce(r.payment_status, '')) = 'paid';
END;
$function$;

REVOKE ALL ON FUNCTION public.find_duplicate_payment_reference(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_payment_reference(text, uuid) TO authenticated;
