-- Give each payment a business purpose so an initial reservation payment and
-- the remaining balance can coexist without looking like a duplicate charge.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'initial_deposit';

UPDATE public.payments p
SET purpose = CASE
  WHEN lower(coalesce(r.payment_type, '')) = 'full'
    OR p.amount_centavos >= round(coalesce(r.rental_price, 0) * 100)::bigint
    THEN 'full_payment'
  ELSE 'initial_deposit'
END
FROM public.reservations r
WHERE r.id = p.reservation_id;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_purpose_check
  CHECK (purpose IN ('initial_deposit', 'full_payment', 'remaining_balance'))
  NOT VALID;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_purpose_check;

-- Preserve the money represented only by legacy reservation flags. These rows
-- make the ledger authoritative without charging anybody or contacting a
-- provider.
INSERT INTO public.payments (
  user_id, reservation_id, provider, provider_ref, amount_centavos,
  currency, status, method, purpose, attempt_started_at, created_at, updated_at
)
SELECT
  r.customer_id,
  r.id,
  'manual',
  'legacy-initial:' || r.id::text,
  round(coalesce(r.deposit, 0) * 100)::bigint,
  'PHP',
  'paid',
  CASE WHEN r.receipt_url IS NULL THEN 'legacy' ELSE 'transfer' END,
  CASE WHEN lower(coalesce(r.payment_type, '')) = 'full' THEN 'full_payment' ELSE 'initial_deposit' END,
  coalesce(r.updated_at, now()),
  coalesce(r.updated_at, now()),
  coalesce(r.updated_at, now())
FROM public.reservations r
WHERE lower(coalesce(r.payment_status, '')) = 'paid'
  AND r.customer_id IS NOT NULL
  AND coalesce(r.deposit, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.reservation_id = r.id
      AND p.status = 'paid'
      AND coalesce(p.requires_refund, false) = false
  )
ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING;

WITH paid_totals AS (
  SELECT
    r.id AS reservation_id,
    r.customer_id,
    r.rental_price,
    r.balance_settled_at,
    r.balance_settled_method,
    coalesce(sum(p.amount_centavos) FILTER (
      WHERE p.status = 'paid' AND coalesce(p.requires_refund, false) = false
    ), 0)::bigint AS paid_centavos
  FROM public.reservations r
  LEFT JOIN public.payments p ON p.reservation_id = r.id
  WHERE r.balance_settled_at IS NOT NULL
  GROUP BY r.id, r.customer_id, r.rental_price, r.balance_settled_at, r.balance_settled_method
)
INSERT INTO public.payments (
  user_id, reservation_id, provider, provider_ref, amount_centavos,
  currency, status, method, purpose, attempt_started_at, created_at, updated_at
)
SELECT
  pt.customer_id,
  pt.reservation_id,
  'manual',
  'legacy-balance:' || pt.reservation_id::text,
  round(coalesce(pt.rental_price, 0) * 100)::bigint - pt.paid_centavos,
  'PHP',
  'paid',
  coalesce(pt.balance_settled_method, 'legacy'),
  'remaining_balance',
  pt.balance_settled_at,
  pt.balance_settled_at,
  pt.balance_settled_at
FROM paid_totals pt
WHERE pt.customer_id IS NOT NULL
  AND round(coalesce(pt.rental_price, 0) * 100)::bigint > pt.paid_centavos
ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING;

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
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
     ) THEN
    RAISE EXCEPTION 'A provider-linked payment attempt is immutable.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

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
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_amount_centavos bigint;
  v_purpose text;
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
    UPDATE public.reservations
    SET payment_status = 'Pending', receipt_url = NULL, updated_at = now()
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
      'payment_purpose', CASE WHEN _approve THEN v_purpose ELSE NULL END
    )
  );

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

CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
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
  v_total_centavos bigint;
  v_paid_centavos bigint;
  v_outstanding_centavos bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;
  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

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
    currency, status, method, purpose, attempt_started_at
  ) VALUES (
    v_res.customer_id, v_res.id, 'manual', 'balance:' || v_res.id::text,
    v_outstanding_centavos, 'PHP', 'paid', _method, 'remaining_balance', now()
  );

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = coalesce(v_actor_name, 'Staff'),
      balance_settled_method = _method,
      updated_at = now()
  WHERE id = _reservation_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, coalesce(v_actor_name, 'Staff'), 'Settled reservation balance',
    'reservation', _reservation_id::text,
    jsonb_build_object(
      'amount', v_outstanding_centavos / 100.0,
      'method', _method,
      'display_id', v_res.display_id
    )
  );

  IF v_res.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_res.customer_id,
      'reservation',
      'Balance settled',
      'The remaining balance for ' || coalesce(v_res.product_name, 'your item') || ' has been paid in full.',
      jsonb_build_object(
        'reservation_id', _reservation_id,
        'display_id', v_res.display_id,
        'amount', v_outstanding_centavos / 100.0
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding_centavos / 100.0,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;

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
  IF auth.uid() IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Reservation payment access required.' USING ERRCODE = '42501';
  END IF;
  RETURN public.settle_reservation_balance(_reservation_id, _method);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_reservation_balance(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reservation_balance(uuid, text)
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
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res public.reservations%rowtype;
  v_outstanding numeric;
  v_previous_status text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found or deleted.'; END IF;
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
    RAISE EXCEPTION 'Record the remaining balance and payment method before handover.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_previous_status := v_res.status;
  UPDATE public.reservations
  SET status = 'Completed', updated_at = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    'Completed reservation handover',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'status', v_res.status,
      'balance_method', v_res.balance_settled_method
    )
  );

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_reservation_handover(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_reservation_handover(uuid, text)
  TO authenticated;

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
  v_other_initial_paid boolean := false;
  v_prior_paid_centavos bigint := 0;
  v_total_centavos bigint := 0;
  v_paid_after_centavos bigint := 0;
  v_fully_paid boolean := false;
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
    SELECT
      coalesce(sum(p.amount_centavos), 0)::bigint,
      coalesce(bool_or(p.purpose IN ('initial_deposit', 'full_payment')), false)
    INTO v_prior_paid_centavos, v_other_initial_paid
    FROM public.payments p
    WHERE p.reservation_id = v_payment.reservation_id
      AND p.id <> v_payment.id
      AND p.status = 'paid'
      AND coalesce(p.requires_refund, false) = false;

    v_total_centavos := round(coalesce(v_res.rental_price, 0) * 100)::bigint;
    v_paid_after_centavos := v_prior_paid_centavos + v_payment.amount_centavos;
    v_refund_required := coalesce(v_res.deleted, false)
      OR lower(coalesce(v_res.status, '')) IN ('cancelled', 'completed')
      OR v_total_centavos <= 0
      OR v_paid_after_centavos > v_total_centavos
      OR (
        v_payment.purpose IN ('initial_deposit', 'full_payment')
        AND v_other_initial_paid
      )
      OR (
        v_payment.purpose = 'remaining_balance'
        AND v_prior_paid_centavos <= 0
      );
    v_fully_paid := NOT v_refund_required AND v_paid_after_centavos >= v_total_centavos;
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
        status = CASE
          WHEN NOT v_refund_required
            AND lower(coalesce(status, '')) IN ('to pay', 'confirmed', 'approved') THEN 'Preparing'
          ELSE status
        END,
        countdown = CASE WHEN NOT v_refund_required THEN false ELSE countdown END,
        balance_settled_at = CASE
          WHEN v_fully_paid AND coalesce(deposit, 0) < coalesce(rental_price, 0)
            THEN coalesce(balance_settled_at, now())
          ELSE balance_settled_at
        END,
        balance_settled_by = CASE
          WHEN v_fully_paid AND coalesce(deposit, 0) < coalesce(rental_price, 0) THEN NULL
          ELSE balance_settled_by
        END,
        balance_settled_by_name = CASE
          WHEN v_fully_paid AND coalesce(deposit, 0) < coalesce(rental_price, 0) THEN 'Online payment'
          ELSE balance_settled_by_name
        END,
        balance_settled_method = CASE
          WHEN v_fully_paid AND coalesce(deposit, 0) < coalesce(rental_price, 0)
            THEN coalesce(_method, 'paymongo')
          ELSE balance_settled_method
        END,
        updated_at = now()
    WHERE id = v_payment.reservation_id;

    IF v_refund_required THEN
      INSERT INTO public.admin_notifications (title, message, type)
      VALUES (
        'Payment requires refund',
        'A payment outside the expected balance was received for reservation '
          || coalesce(v_res.display_id, v_res.id::text) || '.',
        'Payment'
      );

      IF v_res.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (
          v_res.customer_id,
          'reservation',
          'Payment requires refund review',
          'We received a payment that needs boutique review before it can be applied.',
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
        CASE WHEN v_fully_paid THEN 'Payment received in full' ELSE 'Reservation payment received' END,
        CASE
          WHEN v_fully_paid THEN 'Your item has been paid in full.'
          ELSE 'Your reservation payment has been received and the item remains held for you.'
        END,
        jsonb_build_object(
          'reservation_id', v_res.id,
          'display_id', v_res.display_id,
          'payment_status', 'Paid',
          'fully_paid', v_fully_paid
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', _next_status,
    'refund_required', v_refund_required,
    'fully_paid', v_fully_paid
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_webhook(uuid, text, text, text, text, jsonb)
  TO service_role;
