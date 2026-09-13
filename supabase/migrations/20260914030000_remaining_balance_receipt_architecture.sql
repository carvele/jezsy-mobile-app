-- Remaining Balance Manual Receipt Architecture & Unified Payment Submissions
-- Preflight ledger reconciliation, immutable submissions audit table, balance state machine,
-- private internal settlement primitive, and staff review boundary.

-- 1. Preflight Ledger Reconciliation
-- Ensure all historical paid reservations have an authoritative payments ledger entry
-- before total - SUM(paid payments) is used for balance calculations.
INSERT INTO public.payments (
  user_id, reservation_id, provider, provider_ref, amount_centavos,
  currency, status, method, purpose, attempt_started_at, created_at
)
SELECT
  r.customer_id,
  r.id,
  'manual',
  'legacy-initial:' || r.id::text,
  round(coalesce(r.deposit, 0) * 100)::bigint,
  'PHP',
  'paid',
  coalesce(r.manual_payment_method, 'transfer'),
  CASE WHEN lower(coalesce(r.payment_type, '')) = 'full' THEN 'full_payment' ELSE 'initial_deposit' END,
  coalesce(r.created_at, now()),
  coalesce(r.created_at, now())
FROM public.reservations r
WHERE lower(coalesce(r.payment_status, '')) = 'paid'
  AND coalesce(r.deposit, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.reservation_id = r.id
      AND p.status = 'paid'
      AND coalesce(p.requires_refund, false) = false
      AND p.purpose IN ('initial_deposit', 'full_payment')
  )
ON CONFLICT (provider, provider_ref) WHERE (provider_ref IS NOT NULL) DO NOTHING;

-- 2. Truly Immutable Audit Table: manual_payment_submissions
CREATE TABLE IF NOT EXISTS public.manual_payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('initial_deposit', 'remaining_balance')),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  method text NOT NULL CHECK (method IN ('gcash', 'bank_transfer')),
  amount_claimed numeric NOT NULL CHECK (amount_claimed > 0),
  reference_number text NOT NULL CHECK (length(trim(reference_number)) > 0),
  receipt_url text NOT NULL CHECK (length(trim(receipt_url)) > 0),
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  rejection_reason text DEFAULT NULL CHECK (
    rejection_reason IS NULL OR rejection_reason IN (
      'unreadable_receipt', 'wrong_amount', 'invalid_reference', 'wrong_account',
      'duplicate_receipt', 'suspected_fraud', 'other'
    )
  ),
  staff_note text DEFAULT NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_by_name text DEFAULT NULL,
  reviewed_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_payment_submissions_active
  ON public.manual_payment_submissions (reservation_id, purpose)
  WHERE status = 'submitted';

CREATE INDEX IF NOT EXISTS idx_manual_payment_submissions_res_id
  ON public.manual_payment_submissions (reservation_id);

CREATE INDEX IF NOT EXISTS idx_manual_payment_submissions_customer_id
  ON public.manual_payment_submissions (customer_id);

ALTER TABLE public.manual_payment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view manual payment submissions" ON public.manual_payment_submissions;
CREATE POLICY "Staff can view manual payment submissions"
  ON public.manual_payment_submissions FOR SELECT TO authenticated
  USING (public.can_operate_reservations());

-- Revoke direct mutation from clients; trusted RPCs perform inserts and updates
REVOKE ALL ON TABLE public.manual_payment_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.manual_payment_submissions TO authenticated;
GRANT ALL ON TABLE public.manual_payment_submissions TO service_role;

-- 3. Schema Additions on public.reservations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'deposit_submission_id') THEN
    ALTER TABLE public.reservations ADD COLUMN deposit_submission_id uuid REFERENCES public.manual_payment_submissions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_submission_id') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_submission_id uuid REFERENCES public.manual_payment_submissions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_payment_status') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_payment_status text DEFAULT NULL;
    ALTER TABLE public.reservations ADD CONSTRAINT chk_reservations_balance_payment_status
      CHECK (balance_payment_status IS NULL OR balance_payment_status IN ('pending', 'submitted', 'paid', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_receipt_url') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_receipt_url text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_payment_method') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_payment_method text DEFAULT NULL;
    ALTER TABLE public.reservations ADD CONSTRAINT chk_reservations_balance_payment_method
      CHECK (balance_payment_method IS NULL OR balance_payment_method IN ('gcash', 'bank_transfer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_amount_claimed') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_amount_claimed numeric DEFAULT NULL;
    ALTER TABLE public.reservations ADD CONSTRAINT chk_reservations_balance_amount_claimed
      CHECK (balance_amount_claimed IS NULL OR balance_amount_claimed > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_reference_number') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_reference_number text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_receipt_attempt_count') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_receipt_attempt_count integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_payment_issue') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_payment_issue text DEFAULT NULL;
    ALTER TABLE public.reservations ADD CONSTRAINT chk_reservations_balance_payment_issue
      CHECK (balance_payment_issue IS NULL OR balance_payment_issue IN ('image_unclear', 'amount_mismatch', 'reference_unverified', 'verification_failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'balance_rejected_at') THEN
    ALTER TABLE public.reservations ADD COLUMN balance_rejected_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- 4. Ledger Columns on public.payments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'receipt_url') THEN
    ALTER TABLE public.payments ADD COLUMN receipt_url text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'reference_number') THEN
    ALTER TABLE public.payments ADD COLUMN reference_number text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'metadata') THEN
    ALTER TABLE public.payments ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 5. Canonical Admin Notification Ingestion Boundary
CREATE OR REPLACE FUNCTION public.enqueue_admin_notification(
  _title text,
  _message text,
  _type text DEFAULT 'Payment'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.admin_notifications (title, message, type, is_read, created_at)
  VALUES (trim(_title), trim(_message), _type, false, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_admin_notification FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_notification TO service_role;

-- 6. Private Internal Balance Settlement Primitive
CREATE OR REPLACE FUNCTION public._settle_reservation_balance_internal(
  _reservation_id uuid,
  _actor_id uuid,
  _actor_name text,
  _method text,
  _provider text,
  _provider_ref text,
  _receipt_url text DEFAULT NULL,
  _reference_number text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_res public.reservations%rowtype;
  v_total_centavos bigint;
  v_paid_centavos bigint;
  v_outstanding_centavos bigint;
BEGIN
  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The initial reservation payment has not been confirmed yet.';
  END IF;

  v_total_centavos := round(coalesce(v_res.rental_price, 0) * 100)::bigint;

  SELECT coalesce(sum(p.amount_centavos), 0)::bigint INTO v_paid_centavos
  FROM public.payments p
  WHERE p.reservation_id = v_res.id
    AND p.status = 'paid'
    AND coalesce(p.requires_refund, false) = false;

  v_outstanding_centavos := v_total_centavos - v_paid_centavos;

  IF v_outstanding_centavos <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  INSERT INTO public.payments (
    user_id, reservation_id, provider, provider_ref, amount_centavos,
    currency, status, method, purpose, receipt_url, reference_number,
    metadata, attempt_started_at, created_at
  ) VALUES (
    v_res.customer_id, v_res.id, _provider, _provider_ref,
    v_outstanding_centavos, 'PHP', 'paid', _method, 'remaining_balance',
    _receipt_url, _reference_number, coalesce(_metadata, '{}'::jsonb),
    now(), now()
  );

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = _actor_id,
      balance_settled_by_name = coalesce(_actor_name, 'Staff'),
      balance_settled_method = _method,
      balance_payment_status = 'paid',
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    _actor_id, coalesce(_actor_name, 'Staff'), 'Settled reservation balance',
    'reservation', _reservation_id::text,
    jsonb_build_object(
      'amount', v_outstanding_centavos / 100.0,
      'method', _method,
      'provider', _provider,
      'provider_ref', _provider_ref,
      'display_id', v_res.display_id
    )
  );

  IF v_res.customer_id IS NOT NULL THEN
    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Balance settled',
      _body    => 'The remaining balance for ' || coalesce(v_res.product_name, 'your item') || ' has been paid in full.',
      _type    => 'reservation',
      _data    => jsonb_build_object(
        'reservation_id', _reservation_id,
        'display_id', v_res.display_id,
        'amount', v_outstanding_centavos / 100.0,
        'action', 'balance_settled'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding_centavos / 100.0,
    'method', _method,
    'settled_at', v_res.balance_settled_at,
    'reservation', to_jsonb(v_res)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._settle_reservation_balance_internal FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._settle_reservation_balance_internal TO service_role;

-- 7. Public Operational Staff Settlement Wrapper
CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  RETURN public._settle_reservation_balance_internal(
    _reservation_id   => _reservation_id,
    _actor_id         => v_actor,
    _actor_name       => coalesce(v_actor_name, 'Staff'),
    _method           => _method,
    _provider         => 'manual',
    _provider_ref     => 'balance:' || _method || ':' || _reservation_id::text,
    _receipt_url      => NULL,
    _reference_number => NULL,
    _metadata         => jsonb_build_object('settled_by_staff', true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_reservation_balance(uuid, text) TO authenticated;

-- Maintain record_reservation_balance for backward compatibility
CREATE OR REPLACE FUNCTION public.record_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public.settle_reservation_balance(_reservation_id, _method);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_reservation_balance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reservation_balance(uuid, text) TO authenticated;

-- 8. Customer Balance Submission RPC
CREATE OR REPLACE FUNCTION public.submit_reservation_balance_receipt(
  _reservation_id uuid,
  _receipt_path text,
  _method text,
  _amount_claimed numeric,
  _reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_submission_id uuid;
  v_attempt integer;
  v_total_centavos bigint;
  v_paid_centavos bigint;
  v_outstanding_centavos bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF _receipt_path IS NULL OR trim(_receipt_path) = '' THEN
    RAISE EXCEPTION 'A receipt is required.';
  END IF;
  IF (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;
  IF _method IS NULL OR _method NOT IN ('gcash', 'bank_transfer') THEN
    RAISE EXCEPTION 'A valid payment method is required (gcash or bank_transfer).';
  END IF;
  IF _amount_claimed IS NULL OR _amount_claimed <= 0 THEN
    RAISE EXCEPTION 'A valid claimed amount is required.';
  END IF;
  IF nullif(trim(coalesce(_reference_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A payment reference number is required.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;
  IF v_res.customer_id <> v_user_id THEN
    RAISE EXCEPTION 'Not your reservation.' USING ERRCODE = '42501';
  END IF;
  IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The initial reservation payment must be confirmed before paying balance.';
  END IF;
  IF v_res.balance_settled_at IS NOT NULL OR v_res.balance_payment_status = 'paid' THEN
    RAISE EXCEPTION 'The balance has already been paid for this reservation.';
  END IF;
  IF v_res.balance_payment_status = 'submitted' THEN
    RAISE EXCEPTION 'A balance payment receipt is already under review.';
  END IF;
  IF lower(coalesce(v_res.status, '')) NOT IN ('preparing', 'to pickup', 'fitting', 'ready', 'confirmed', 'approved') THEN
    RAISE EXCEPTION 'This reservation is not eligible for balance payment.';
  END IF;

  v_total_centavos := round(coalesce(v_res.rental_price, 0) * 100)::bigint;
  SELECT coalesce(sum(p.amount_centavos), 0)::bigint INTO v_paid_centavos
  FROM public.payments p
  WHERE p.reservation_id = v_res.id
    AND p.status = 'paid'
    AND coalesce(p.requires_refund, false) = false;
  v_outstanding_centavos := v_total_centavos - v_paid_centavos;

  IF v_outstanding_centavos <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  v_attempt := coalesce(v_res.balance_receipt_attempt_count, 0) + 1;

  INSERT INTO public.manual_payment_submissions (
    reservation_id, customer_id, purpose, status, method,
    amount_claimed, reference_number, receipt_url, attempt_number,
    created_at, updated_at
  ) VALUES (
    v_res.id, v_user_id, 'remaining_balance', 'submitted', _method,
    _amount_claimed, trim(_reference_number), _receipt_path, v_attempt,
    now(), now()
  )
  RETURNING id INTO v_submission_id;

  UPDATE public.reservations
  SET balance_submission_id = v_submission_id,
      balance_payment_status = 'submitted',
      balance_receipt_url = _receipt_path,
      balance_payment_method = _method,
      balance_amount_claimed = _amount_claimed,
      balance_reference_number = trim(_reference_number),
      balance_receipt_attempt_count = v_attempt,
      balance_payment_issue = NULL,
      updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  PERFORM public.enqueue_admin_notification(
    _title   => 'Remaining balance receipt submitted',
    _message => 'Receipt submitted for reservation #' || coalesce(v_res.display_id, v_res.id::text) || ' (' || _method || ' ₱' || _amount_claimed::text || ').',
    _type    => 'Payment'
  );

  RETURN to_jsonb(v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_reservation_balance_receipt FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_reservation_balance_receipt TO authenticated;

-- 9. Staff Balance Review RPC
CREATE OR REPLACE FUNCTION public.review_reservation_balance_receipt(
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
  v_sub public.manual_payment_submissions%rowtype;
  v_sanitized_issue text;
  v_reason_text text;
  v_settle_result jsonb;
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

  IF v_res.balance_payment_status <> 'submitted' OR v_res.balance_submission_id IS NULL THEN
    RAISE EXCEPTION 'This balance receipt is no longer awaiting review.';
  END IF;

  SELECT * INTO v_sub
  FROM public.manual_payment_submissions
  WHERE id = v_res.balance_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balance payment submission record not found.';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  IF _approve THEN
    v_settle_result := public._settle_reservation_balance_internal(
      _reservation_id   => _reservation_id,
      _actor_id         => v_actor,
      _actor_name       => coalesce(v_actor_name, 'Staff'),
      _method           => coalesce(v_res.balance_payment_method, 'transfer'),
      _provider         => 'manual',
      _provider_ref     => 'receipt:balance:' || _reservation_id::text,
      _receipt_url      => v_res.balance_receipt_url,
      _reference_number => v_res.balance_reference_number,
      _metadata         => jsonb_build_object(
        'submission_id', v_res.balance_submission_id,
        'amount_claimed', v_res.balance_amount_claimed
      )
    );

    UPDATE public.manual_payment_submissions
    SET status = 'approved',
        reviewed_by = v_actor,
        reviewed_by_name = coalesce(v_actor_name, 'Staff'),
        reviewed_at = now(),
        updated_at = now()
    WHERE id = v_res.balance_submission_id;

    SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id;
    RETURN to_jsonb(v_res);
  ELSE
    v_sanitized_issue := CASE _reason_code
      WHEN 'unreadable_receipt' THEN 'image_unclear'
      WHEN 'wrong_amount'       THEN 'amount_mismatch'
      WHEN 'invalid_reference'  THEN 'reference_unverified'
      WHEN 'suspected_fraud'    THEN 'verification_failed'
      ELSE 'verification_failed'
    END;

    v_reason_text := CASE _reason_code
      WHEN 'unreadable_receipt' THEN 'The receipt image could not be verified.'
      WHEN 'wrong_amount'       THEN 'The amount shown does not match your remaining balance.'
      WHEN 'invalid_reference'  THEN 'The payment reference could not be verified.'
      WHEN 'suspected_fraud'    THEN 'We couldn''t verify this payment. Please contact the boutique for assistance.'
      WHEN 'duplicate_receipt'  THEN 'This receipt has already been submitted.'
      ELSE 'We couldn''t verify your balance payment proof.'
    END;

    UPDATE public.manual_payment_submissions
    SET status = 'rejected',
        rejection_reason = _reason_code,
        staff_note = _staff_note,
        reviewed_by = v_actor,
        reviewed_by_name = coalesce(v_actor_name, 'Staff'),
        reviewed_at = now(),
        updated_at = now()
    WHERE id = v_res.balance_submission_id;

    UPDATE public.reservations
    SET balance_payment_status = 'rejected',
        balance_receipt_url = NULL,
        balance_reference_number = NULL,
        balance_amount_claimed = NULL,
        balance_payment_issue = v_sanitized_issue,
        balance_rejected_at = now(),
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;

    IF v_res.customer_id IS NOT NULL THEN
      PERFORM public.enqueue_customer_notification(
        _user_id => v_res.customer_id,
        _title   => 'Remaining balance proof needs attention',
        _body    => v_reason_text || ' Please resubmit balance payment for ' || coalesce(v_res.product_name, 'your item') || '.',
        _type    => 'reservation',
        _data    => jsonb_build_object(
          'reservation_id', _reservation_id,
          'display_id', v_res.display_id,
          'action', 'balance_payment_rejected',
          'payment_issue', v_sanitized_issue
        )
      );
    END IF;

    INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
    VALUES (
      v_actor, coalesce(v_actor_name, 'Staff'), 'Rejected balance receipt',
      'reservation', _reservation_id::text,
      jsonb_build_object(
        'reason_code', _reason_code,
        'staff_note', _staff_note,
        'submission_id', v_res.balance_submission_id,
        'display_id', v_res.display_id
      )
    );

    RETURN to_jsonb(v_res);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_reservation_balance_receipt FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_reservation_balance_receipt TO authenticated;

-- 10. Unified Option B Initial Deposit Integration
-- Update submit_reservation_receipt to record into manual_payment_submissions
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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
  v_submission_id uuid;
  v_attempt integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
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
  WHERE id = _reservation_id AND coalesce(deleted, false) = false FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
  IF v_reservation.customer_id <> v_user_id THEN RAISE EXCEPTION 'Not your reservation.' USING ERRCODE = '42501'; END IF;
  IF lower(coalesce(v_reservation.payment_status, '')) = 'paid' THEN
    RAISE EXCEPTION 'This reservation is already paid.';
  END IF;
  IF lower(coalesce(v_reservation.payment_status, '')) = 'submitted' THEN
    RAISE EXCEPTION 'A receipt is already under review.';
  END IF;
  IF NOT public.is_awaiting_payment_status(v_reservation.status) THEN
    RAISE EXCEPTION 'This reservation is not awaiting payment yet.';
  END IF;
  IF v_reservation.payment_due_at IS NOT NULL AND v_reservation.payment_due_at < now() THEN
    RAISE EXCEPTION 'The payment window has closed. Please contact the boutique.';
  END IF;

  v_attempt := coalesce(v_reservation.manual_receipt_attempt_count, 0) + 1;

  INSERT INTO public.manual_payment_submissions (
    reservation_id, customer_id, purpose, status, method,
    amount_claimed, reference_number, receipt_url, attempt_number,
    created_at, updated_at
  ) VALUES (
    v_reservation.id, v_user_id, 'initial_deposit', 'submitted', _method,
    _amount_claimed, trim(_reference_number), _receipt_path, v_attempt,
    now(), now()
  )
  RETURNING id INTO v_submission_id;

  UPDATE public.reservations
  SET deposit_submission_id = v_submission_id,
      receipt_url = _receipt_path,
      payment_status = 'Submitted',
      manual_payment_method = _method,
      manual_amount_claimed = _amount_claimed,
      manual_reference_number = trim(_reference_number),
      manual_receipt_attempt_count = v_attempt,
      updated_at = now()
  WHERE id = _reservation_id RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_reservation_receipt(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_reservation_receipt(uuid, text, text, numeric, text) TO authenticated;

-- Update review_reservation_receipt to record into manual_payment_submissions
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
        'display_id', v_res.display_id,
        'action', 'receipt_rejected',
        'retry_deadline', (now() + make_interval(mins => v_retry_minutes))
      )
    );

    INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
    VALUES (
      v_actor, coalesce(v_actor_name, 'Staff'), 'Rejected reservation receipt',
      'reservation', _reservation_id::text,
      jsonb_build_object(
        'reason_code', _reason_code,
        'staff_note', _staff_note,
        'submission_id', v_res.deposit_submission_id,
        'display_id', v_res.display_id
      )
    );
  END IF;

  RETURN to_jsonb(v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_reservation_receipt(uuid, boolean, text, text) TO authenticated;
