-- =============================================================================
-- 20260920140105_pickup_policy_hardening.sql
--
-- Hardens three production RPCs to enforce the final customer-fault policy:
--
-- 1. create_reservation_multi
--    - New-workflow (date=NULL, time=NULL) requires non-null terms acceptance.
--    - Bogus non-null terms are still canonicalized (unchanged behavior).
--    - Legacy both-present workflow remains backward-compatible.
--
-- 2. cancel_no_show_reservation
--    - Rejects fully-paid orders (must go through mark_unclaimed_reservation).
--    - Forfeits ALL settled non-refunded payments on customer-fault expiry;
--      no partial refund for amounts above the deposit.
--
-- 3. cancel_reservation_after_ready (BD-7)
--    - Forfeits ALL settled non-refunded payments on customer-fault voluntary
--      cancellation; no refund regardless of amount paid.
--    - Reservation always ends Cancelled / Cancelled.
--
-- Merchant-fault path (cancel_reservation_as_manager) is NOT changed.
-- mark_unclaimed_reservation, sweep_pickup_deadlines are NOT changed.
-- =============================================================================

-- =============================================================================
-- 1. create_reservation_multi
--    Change: enforce non-null terms when both date and time are NULL.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text DEFAULT NULL,
  _appointment_time text DEFAULT NULL,
  _receipt_path text DEFAULT NULL::text,
  _payment_option text DEFAULT 'deposit'::text,
  _customer_id uuid DEFAULT NULL::uuid,
  _pickup_terms_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_user_id uuid;
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_appointment timestamptz;
  v_payment_due_at timestamptz;
  v_manual_max_minutes integer;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
  v_item jsonb;
  v_quantity integer;
  v_total numeric := 0;
  v_deposit numeric;
  v_line_count integer;
  v_first jsonb;
  v_items_resolved jsonb := '[]'::jsonb;
  v_canonical_terms_version text := 'v2026-09-pickup';
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_user_id := coalesce(_customer_id, v_actor_id);
  IF _customer_id IS NOT NULL
     AND _customer_id <> v_actor_id
     AND NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  -- Staff transactional isolation
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  IF v_option NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A reservation must contain at least one item.';
  END IF;

  v_line_count := jsonb_array_length(_items);
  IF v_line_count > 20 THEN
    RAISE EXCEPTION 'A reservation cannot contain more than 20 items.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    IF coalesce((v_item->>'quantity')::integer, 1) < 1 THEN
      RAISE EXCEPTION 'Quantity must be positive.';
    END IF;
    IF nullif(v_item->>'product_id', '') IS NULL THEN
      RAISE EXCEPTION 'Every reservation item needs a product.';
    END IF;
  END LOOP;

  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  IF (nullif(_date, '') IS NULL) AND (nullif(_appointment_time, '') IS NULL) THEN
    -- Phase 2 new workflow: no appointment time.
    -- Terms acceptance is MANDATORY so the row is not permanently excluded from
    -- the automatic pickup deadline policy.
    IF nullif(trim(coalesce(_pickup_terms_version, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Pickup policy terms acceptance is required when no appointment date is provided.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_appointment := NULL;
  ELSIF (nullif(_date, '') IS NOT NULL) AND (nullif(_appointment_time, '') IS NOT NULL) THEN
    -- Legacy workflow: both provided
    v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';
  ELSE
    RAISE EXCEPTION 'Both date and time must be provided, or both must be empty.';
  END IF;

  v_manual_max_minutes := coalesce(
    (SELECT (value->>'manual_max_minutes')::integer FROM public.settings WHERE key = 'reservationPaymentWindow'),
    120
  );

  IF v_appointment IS NOT NULL THEN
    v_payment_due_at := LEAST(v_appointment - interval '30 minutes', now() + make_interval(mins => v_manual_max_minutes));
    IF v_payment_due_at < now() + interval '90 minutes' THEN
      v_payment_due_at := LEAST(now() + interval '90 minutes', v_appointment);
    END IF;
  ELSE
    v_payment_due_at := now() + make_interval(mins => v_manual_max_minutes);
  END IF;

  FOR v_item IN
    WITH raw AS (
      SELECT
        (entry.value->>'product_id')::uuid AS product_id,
        nullif(trim(entry.value->>'size'), '') AS size,
        nullif(trim(entry.value->>'color'), '') AS color,
        (entry.value->>'quantity')::integer AS qty
      FROM jsonb_array_elements(_items) AS entry
    )
    SELECT r.*, p.name, p.price, p.status as p_status, p.stock
    FROM raw r
    JOIN public.products p ON p.id = r.product_id
  LOOP
    IF v_item.p_status <> 'active' THEN
      RAISE EXCEPTION 'Product % is not available.', v_item.name;
    END IF;
    IF coalesce(v_item.stock, 0) < v_item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %.', v_item.name;
    END IF;

    v_total := v_total + (v_item.price * v_item.qty);
    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_item.product_id,
      'product_name', v_item.name,
      'size', v_item.size,
      'color', v_item.color,
      'quantity', v_item.qty,
      'unit_price', v_item.price,
      'image_url', (SELECT image_url FROM public.product_images WHERE product_id = v_item.product_id ORDER BY display_order ASC LIMIT 1)
    );
  END LOOP;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;

  LOOP
    v_display_id := 'RES-' || upper(substr(md5(random()::text), 1, 8));
    BEGIN
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 5 THEN RAISE EXCEPTION 'Could not generate unique ID.'; END IF;
    END;
  END LOOP;

  v_payment_type := CASE v_option WHEN 'full' THEN 'Full' ELSE 'Deposit' END;
  IF v_option = 'full' THEN
    v_deposit := round(v_total, 2);
  ELSE
    v_deposit := round(v_total * 0.5, 2);
  END IF;

  v_first := v_items_resolved -> 0;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at, countdown,
    purchase_mode, sales_channel, pickup_terms_version, pickup_terms_accepted_at
  ) VALUES (
    v_display_id,
    v_user_id,
    coalesce(nullif(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    (v_first->>'product_id')::uuid,
    v_first->>'product_name',
    v_first->>'image_url',
    v_first->>'size',
    v_first->>'color',
    (v_first->>'quantity')::integer,
    round(v_total, 2),
    v_deposit,
    NULLIF(_date, '')::date,
    NULL,
    v_appointment,
    nullif(_receipt_path, ''),
    'To Pay',
    'Pending',
    v_payment_type,
    v_payment_due_at,
    true,
    'reservation', 'mobile',
    -- Canonical version is always written server-side; bogus client values are ignored.
    CASE WHEN nullif(trim(coalesce(_pickup_terms_version, '')), '') IS NOT NULL THEN v_canonical_terms_version ELSE NULL END,
    CASE WHEN nullif(trim(coalesce(_pickup_terms_version, '')), '') IS NOT NULL THEN now() ELSE NULL END
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price
  )
  SELECT
    v_reservation.id,
    (line->>'product_id')::uuid,
    line->>'product_name',
    line->>'image_url',
    line->>'size',
    line->>'color',
    (line->>'quantity')::integer,
    (line->>'unit_price')::numeric
  FROM jsonb_array_elements(v_items_resolved) line;

  RETURN to_jsonb(v_reservation) || jsonb_build_object('items', v_items_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) TO authenticated;


-- =============================================================================
-- 2. cancel_no_show_reservation
--    Changes:
--    - Rejects fully-paid orders before entering cancellation logic.
--    - Forfeits ALL settled payments (no partial refund above deposit).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_no_show_reservation(
  _reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res               public.reservations%rowtype;
  v_canonical_due     bigint;
  v_total_paid        bigint := 0;
  v_total_forfeited   bigint := 0;
  v_next_pstatus      text;
  v_payment           record;
BEGIN
  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Only Ready reservations can expire.' USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(v_res.extension_status, '') = 'pending' THEN
    RAISE EXCEPTION 'Cannot auto-cancel while a pickup extension request is pending.' USING ERRCODE = 'check_violation';
  END IF;

  -- Authoritative deadline expiry guard
  IF v_res.pickup_deadline_at IS NULL OR v_res.pickup_deadline_at >= now() THEN
    RAISE EXCEPTION 'Pickup deadline has not expired.' USING ERRCODE = 'check_violation';
  END IF;

  -- Calculate canonical amount due (rental_price in centavos)
  v_canonical_due := round(coalesce(v_res.rental_price, 0) * 100)::bigint;

  -- Sum all currently settled, non-refunded payments
  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  -- Fully-paid orders must be routed through mark_unclaimed_reservation(), not here.
  -- The sweep branches correctly; this guard prevents direct misuse.
  IF v_total_paid >= v_canonical_due THEN
    RAISE EXCEPTION 'Reservation % is fully paid and cannot be auto-cancelled. Route through mark_unclaimed_reservation().',
      v_res.display_id
    USING ERRCODE = 'check_violation';
  END IF;

  -- Customer-fault no-refund policy: forfeit all settled non-refunded payments.
  -- No partial refund is issued regardless of how much above the deposit was paid.
  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = _reservation_id AND status = 'paid' AND refund_disbursed_at IS NULL
    ORDER BY CASE WHEN purpose IN ('initial_deposit', 'full_payment') THEN 0 ELSE 1 END, created_at
    FOR UPDATE
  LOOP
    UPDATE public.payments
    SET forfeited_centavos       = v_payment.amount_centavos,
        refund_required_centavos = NULL,
        requires_refund          = false,
        refund_required_at       = NULL,
        updated_at               = now()
    WHERE id = v_payment.id;
    v_total_forfeited := v_total_forfeited + v_payment.amount_centavos;
  END LOOP;

  -- Forfeiture must equal total settled payments
  IF v_total_forfeited <> v_total_paid THEN
    RAISE EXCEPTION 'Forfeiture allocation mismatch: expected % but allocated %.', v_total_paid, v_total_forfeited;
  END IF;

  v_next_pstatus := 'Cancelled';

  UPDATE public.reservations
  SET status              = 'Cancelled',
      payment_status      = v_next_pstatus,
      cancellation_reason = 'Pickup deadline expired',
      countdown           = false,
      updated_at          = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, action, target_type, target_id, details)
  VALUES (
    NULL, 'pickup_expired', 'reservation', _reservation_id::text,
    jsonb_build_object(
      'display_id', v_res.display_id,
      'pickup_deadline_at', v_res.pickup_deadline_at,
      'total_forfeited_centavos', v_total_forfeited,
      'new_payment_status', v_next_pstatus
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'status', 'Cancelled',
    'payment_status', v_next_pstatus,
    'total_forfeited_centavos', v_total_forfeited
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_no_show_reservation(uuid) FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 3. cancel_reservation_after_ready (BD-7)
--    Change: forfeit ALL settled payments on customer-fault voluntary cancel.
--    Result is always Cancelled / Cancelled; no refund queue.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_reservation_after_ready(
  _reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor             uuid := auth.uid();
  v_res               public.reservations%rowtype;
  v_total_paid        bigint := 0;
  v_total_forfeited   bigint := 0;
  v_payment           record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Only reservations that are Ready for Pickup can be cancelled this way.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_res.pickup_deadline_at IS NULL OR v_res.pickup_deadline_at <= now() THEN
    RAISE EXCEPTION 'The pickup deadline has passed. This reservation is handled by the expiry process.' USING ERRCODE = 'check_violation';
  END IF;

  -- deposit > 0 guard is retained: cancellation requires a deposit to be on record
  IF round(coalesce(v_res.deposit, 0) * 100)::bigint <= 0 THEN
    RAISE EXCEPTION 'Cannot determine reservation deposit amount.' USING ERRCODE = 'check_violation';
  END IF;

  -- Calculate total currently settled
  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  -- Customer-fault no-refund policy: forfeit ALL settled payments, no refund.
  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = _reservation_id AND status = 'paid' AND refund_disbursed_at IS NULL
    ORDER BY CASE WHEN purpose IN ('initial_deposit', 'full_payment') THEN 0 ELSE 1 END, created_at
    FOR UPDATE
  LOOP
    UPDATE public.payments
    SET forfeited_centavos       = v_payment.amount_centavos,
        refund_required_centavos = NULL,
        requires_refund          = false,
        refund_required_at       = NULL,
        updated_at               = now()
    WHERE id = v_payment.id;
    v_total_forfeited := v_total_forfeited + v_payment.amount_centavos;
  END LOOP;

  IF v_total_forfeited <> v_total_paid THEN
    RAISE EXCEPTION 'Forfeiture allocation mismatch: expected % but allocated %.', v_total_paid, v_total_forfeited;
  END IF;

  UPDATE public.reservations
  SET status              = 'Cancelled',
      payment_status      = 'Cancelled',
      cancellation_reason = 'Cancelled by customer after Ready',
      countdown           = false,
      updated_at          = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, action, target_type, target_id, details)
  VALUES (
    v_actor, 'customer_cancelled_after_ready', 'reservation', _reservation_id::text,
    jsonb_build_object(
      'display_id', v_res.display_id,
      'total_paid_centavos', v_total_paid,
      'total_forfeited_centavos', v_total_forfeited,
      'new_payment_status', 'Cancelled'
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'status', 'Cancelled',
    'payment_status', 'Cancelled',
    'total_forfeited_centavos', v_total_forfeited
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_reservation_after_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_after_ready(uuid) TO authenticated;
