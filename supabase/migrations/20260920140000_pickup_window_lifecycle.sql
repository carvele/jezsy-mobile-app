-- =============================================================================
-- 20260920140000_pickup_window_lifecycle.sql
--
-- Implements the 3-boutique-open-day pickup window model.
-- This migration DOES NOT schedule the cron sweep. The cron must be enabled
-- via 20260920140100_enable_pickup_deadline_cron.sql AFTER verifying backfill.
--
-- Modifications in this version:
-- 1. Bounded search horizon in compute_pickup_deadline to prevent infinite loops.
-- 2. Stricter CHECK constraints on extension_status lifecycle.
-- 3. Payment-forfeiture accumulator logic replacing row-by-row iteration.
-- 4. Authoritative pickup_deadline_at guard inside cancel_no_show_reservation().
-- 5. Deterministic settings UPSERT.
-- =============================================================================

-- =============================================================================
-- 1. compute_pickup_deadline (hardened)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.compute_pickup_deadline(
  _start_at    timestamptz,
  _window_days integer DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_days integer;
  v_cursor_date date;
  v_open_count  integer := 0;
  v_dow         integer;
  v_is_closed   boolean;
  v_close_time  time;
  v_loop_limit  integer := 60;
  v_loop_count  integer := 0;
BEGIN
  IF _window_days IS NOT NULL THEN
    v_window_days := _window_days;
  ELSE
    SELECT coalesce((value->>'pickup_window_days')::integer, 3)
    INTO v_window_days
    FROM public.settings WHERE key = 'pickupPolicy';
    v_window_days := coalesce(v_window_days, 3);
  END IF;

  IF v_window_days < 1 THEN
    RAISE EXCEPTION 'Pickup window days must be at least 1.';
  END IF;

  v_cursor_date := (_start_at AT TIME ZONE 'Asia/Manila')::date;

  WHILE v_open_count < v_window_days LOOP
    IF v_loop_count >= v_loop_limit THEN
      RAISE EXCEPTION 'Unable to compute pickup deadline: store_hours are incomplete or have too many consecutive closed days.';
    END IF;
    
    v_cursor_date := v_cursor_date + 1;
    v_dow := extract(dow from v_cursor_date)::integer;

    SELECT is_closed, close_time
    INTO v_is_closed, v_close_time
    FROM public.store_hours
    WHERE day_of_week = v_dow;

    -- Skip if explicitly closed, no record found, OR open but missing close_time
    IF NOT FOUND OR coalesce(v_is_closed, true) OR v_close_time IS NULL THEN
      v_loop_count := v_loop_count + 1;
      CONTINUE;
    END IF;

    v_open_count := v_open_count + 1;
    v_loop_count := v_loop_count + 1;
  END LOOP;

  RETURN (v_cursor_date + v_close_time) AT TIME ZONE 'Asia/Manila';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_pickup_deadline(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 2. compute_extension_deadline
-- =============================================================================
CREATE OR REPLACE FUNCTION public.compute_extension_deadline(
  _existing_deadline timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.compute_pickup_deadline(_existing_deadline, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_extension_deadline(timestamptz)
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 3. New columns and constraints on public.reservations
-- =============================================================================
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS pickup_ready_at         timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_deadline_at      timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_terms_version    text,
  ADD COLUMN IF NOT EXISTS pickup_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS extension_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS extension_reason        text,
  ADD COLUMN IF NOT EXISTS extension_evidence_path text,
  ADD COLUMN IF NOT EXISTS extension_status        text
    CHECK (extension_status IS NULL
           OR extension_status IN ('pending', 'approved', 'denied')),
  ADD COLUMN IF NOT EXISTS extension_resolved_at   timestamptz,
  ADD COLUMN IF NOT EXISTS extension_resolved_by   uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS extension_resolution_notes text,
  ADD COLUMN IF NOT EXISTS extension_deadline_at   timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_extension_complete'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_extension_complete CHECK (
        (extension_requested_at IS NULL AND extension_status IS NULL)
        OR
        (extension_requested_at IS NOT NULL AND extension_status IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_extension_lifecycle'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_extension_lifecycle CHECK (
        (extension_status IS NULL AND extension_resolved_at IS NULL AND extension_resolved_by IS NULL AND extension_deadline_at IS NULL) OR
        (extension_status = 'pending' AND extension_resolved_at IS NULL AND extension_resolved_by IS NULL AND extension_deadline_at IS NULL) OR
        (extension_status = 'approved' AND extension_resolved_at IS NOT NULL AND extension_resolved_by IS NOT NULL AND extension_deadline_at IS NOT NULL) OR
        (extension_status = 'denied' AND extension_resolved_at IS NOT NULL AND extension_resolved_by IS NOT NULL AND extension_deadline_at IS NULL)
      );
  END IF;
END $$;

-- Update status check constraint for Unclaimed
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'Preparing', 'Ready', 'To Pickup', 'Active', 'Completed', 'Cancelled', 'Unclaimed'
  )) NOT VALID;

-- Update stock reservation logic to include Unclaimed
CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT coalesce(_deleted, false)
     AND lower(trim(coalesce(_status, ''))) IN (
       'pending', 'request approval', 'confirmed', 'approved', 'to pay',
       'preparing', 'ready', 'to pickup', 'active', 'unclaimed'
     );
$function$;

-- =============================================================================
-- 4. New columns on public.payments
-- =============================================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_required_centavos bigint,
  ADD COLUMN IF NOT EXISTS forfeited_centavos       bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_refund_nonneg'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_refund_nonneg
        CHECK (refund_required_centavos IS NULL OR refund_required_centavos >= 0),
      ADD CONSTRAINT payments_forfeiture_nonneg
        CHECK (forfeited_centavos IS NULL OR forfeited_centavos >= 0),
      ADD CONSTRAINT payments_refund_forfeiture_sum
        CHECK (
          coalesce(refund_required_centavos, 0) + coalesce(forfeited_centavos, 0)
          <= amount_centavos
        );
  END IF;
END $$;

-- =============================================================================
-- 5. New columns on public.return_refund_requests
-- =============================================================================
ALTER TABLE public.return_refund_requests
  ADD COLUMN IF NOT EXISTS return_received_at      timestamptz,
  ADD COLUMN IF NOT EXISTS return_received_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS inspection_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_verified_by  uuid REFERENCES public.profiles(id);

-- =============================================================================
-- 6. notification_events_dedup
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notification_events_dedup (
  event_key  text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.notification_events_dedup FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 7. pickupPolicy settings entry (deterministic UPSERT)
-- =============================================================================
INSERT INTO public.settings (key, value)
VALUES (
  'pickupPolicy',
  jsonb_build_object(
    'pickup_window_days',    3,
    'pickup_extension_days', 1
  )
)
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object(
  'pickup_window_days',    3,
  'pickup_extension_days', 1
);

-- =============================================================================
-- 8. transition_reservation_status
-- =============================================================================
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
  v_actor         uuid := auth.uid();
  v_actor_name    text;
  v_res           public.reservations%rowtype;
  v_old           text;
  v_next          text;
  v_stored_next   text;
  v_pickup_ready  timestamptz;
  v_pickup_dl     timestamptz;
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

  v_old  := lower(trim(coalesce(v_res.status, '')));
  v_next := lower(trim(coalesce(_next_status, '')));

  IF v_old <> lower(trim(coalesce(_expected_status, ''))) THEN
    RAISE EXCEPTION 'Reservation changed since it was loaded. Refresh and try again.' USING ERRCODE = 'serialization_failure';
  END IF;
  IF v_old IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'A terminal reservation cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_old IN ('pending', 'request approval') AND v_next IN ('to pay', 'confirmed') THEN
    v_stored_next := 'To Pay';
  ELSIF v_old IN ('to pay', 'confirmed', 'approved') AND v_next = 'preparing' THEN
    IF lower(coalesce(v_res.payment_status, '')) <> 'paid' THEN
      RAISE EXCEPTION 'Payment must be confirmed before preparation starts.' USING ERRCODE = 'check_violation';
    END IF;
    v_stored_next := 'Preparing';
  ELSIF v_old = 'preparing' AND v_next IN ('ready', 'to pickup') THEN
    v_stored_next := 'Ready';
    v_pickup_ready := now();
    v_pickup_dl    := public.compute_pickup_deadline(v_pickup_ready);
  ELSE
    RAISE EXCEPTION 'Unsupported reservation transition from % to %.', v_res.status, _next_status USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Owner')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  UPDATE public.reservations
  SET status          = v_stored_next,
      confirmed_by_id   = CASE WHEN v_stored_next = 'To Pay' THEN v_actor ELSE confirmed_by_id END,
      confirmed_by_name = CASE WHEN v_stored_next = 'To Pay' THEN coalesce(v_actor_name, 'Owner') ELSE confirmed_by_name END,
      confirmed_at      = CASE WHEN v_stored_next = 'To Pay' THEN now() ELSE confirmed_at END,
      assigned_staff_id = CASE WHEN v_stored_next = 'Preparing' THEN v_actor ELSE assigned_staff_id END,
      countdown         = CASE WHEN v_stored_next = 'Preparing' THEN false ELSE countdown END,
      pickup_ready_at   = CASE WHEN v_stored_next = 'Ready' THEN v_pickup_ready ELSE pickup_ready_at END,
      pickup_deadline_at = CASE WHEN v_stored_next = 'Ready' THEN v_pickup_dl ELSE pickup_deadline_at END,
      updated_at        = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Owner'),
    'Changed reservation status',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'previous_status',   _expected_status,
      'new_status',        v_stored_next,
      'pickup_ready_at',   v_res.pickup_ready_at,
      'pickup_deadline_at', v_res.pickup_deadline_at
    )
  );

  RETURN jsonb_build_object(
    'reservation_id',    _reservation_id,
    'status',            v_res.status,
    'pickup_ready_at',   v_res.pickup_ready_at,
    'pickup_deadline_at', v_res.pickup_deadline_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_reservation_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_reservation_status(uuid, text, text) TO authenticated;

-- =============================================================================
-- 9. request_pickup_extension
-- =============================================================================
CREATE OR REPLACE FUNCTION public.request_pickup_extension(
  _reservation_id uuid,
  _reason         text,
  _evidence_path  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_res   public.reservations%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  IF nullif(trim(_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required.' USING ERRCODE = 'check_violation'; END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Pickup extensions can only be requested for reservations that are Ready for Pickup.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_res.pickup_deadline_at IS NULL THEN RAISE EXCEPTION 'This reservation has no active pickup deadline.' USING ERRCODE = 'check_violation'; END IF;

  IF v_res.pickup_deadline_at <= now() THEN
    RAISE EXCEPTION 'The pickup deadline has passed. Extensions are no longer available.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_res.extension_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'You have already used your one pickup extension request for this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.reservations
  SET extension_requested_at = now(),
      extension_reason       = trim(_reason),
      extension_evidence_path = nullif(trim(coalesce(_evidence_path, '')), ''),
      extension_status       = 'pending',
      updated_at             = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.admin_notifications (title, message, type)
  VALUES (
    'Pickup Extension Request',
    coalesce(v_res.product_name, 'A reservation') || ' (#' || coalesce(v_res.display_id, '') || ') has a pending pickup extension request.',
    'PickupExtension'
  );

  RETURN jsonb_build_object(
    'reservation_id',      _reservation_id,
    'extension_status',    'pending',
    'pickup_deadline_at',  v_res.pickup_deadline_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_pickup_extension(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_pickup_extension(uuid, text, text) TO authenticated;

-- =============================================================================
-- 10. resolve_pickup_extension
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_pickup_extension(
  _reservation_id uuid,
  _approve        boolean,
  _notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_actor_name text;
  v_res       public.reservations%rowtype;
  v_new_deadline timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN RAISE EXCEPTION 'Staff or admin authorization required.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND coalesce(deleted, false) = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;

  IF coalesce(v_res.extension_status, '') <> 'pending' THEN
    RAISE EXCEPTION 'There is no pending extension request on this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  IF lower(trim(coalesce(v_res.status, ''))) NOT IN ('ready', 'to pickup') THEN
    RAISE EXCEPTION 'Cannot resolve extension on a % reservation.', v_res.status USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name FROM public.profiles WHERE id = v_actor AND deleted = false AND is_blocked = false;

  IF _approve THEN
    v_new_deadline := public.compute_extension_deadline(v_res.pickup_deadline_at);

    UPDATE public.reservations
    SET extension_status          = 'approved',
        extension_resolved_at     = now(),
        extension_resolved_by     = v_actor,
        extension_resolution_notes = nullif(trim(coalesce(_notes, '')), ''),
        extension_deadline_at     = v_new_deadline,
        pickup_deadline_at        = v_new_deadline,
        updated_at                = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Pickup extension approved',
      _body    => 'Your pickup extension for ' || coalesce(v_res.product_name, 'your item') ||
                  ' was approved. New deadline: ' || to_char(v_new_deadline AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM') || '.',
      _type    => 'reservation',
      _data    => jsonb_build_object('reservation_id', _reservation_id, 'pickup_deadline_at', v_new_deadline)
    );
  ELSE
    UPDATE public.reservations
    SET extension_status          = 'denied',
        extension_resolved_at     = now(),
        extension_resolved_by     = v_actor,
        extension_resolution_notes = nullif(trim(coalesce(_notes, '')), ''),
        updated_at                = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;

    PERFORM public.enqueue_customer_notification(
      _user_id => v_res.customer_id,
      _title   => 'Pickup extension not approved',
      _body    => 'Your extension request for ' || coalesce(v_res.product_name, 'your item') ||
                  ' was not approved. Please collect by ' || to_char(v_res.pickup_deadline_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY · HH12:MI AM') || '.',
      _type    => 'reservation',
      _data    => jsonb_build_object('reservation_id', _reservation_id, 'pickup_deadline_at', v_res.pickup_deadline_at)
    );
  END IF;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, coalesce(v_actor_name, 'Staff'),
    CASE WHEN _approve THEN 'Approved pickup extension' ELSE 'Denied pickup extension' END,
    'reservation', _reservation_id::text,
    jsonb_build_object('display_id', v_res.display_id, 'approved', _approve, 'notes', _notes, 'pickup_deadline_at', v_res.pickup_deadline_at)
  );

  RETURN jsonb_build_object('reservation_id', _reservation_id, 'approved', _approve, 'pickup_deadline_at', v_res.pickup_deadline_at);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_pickup_extension(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_pickup_extension(uuid, boolean, text) TO authenticated;

-- =============================================================================
-- 11. cancel_reservation_after_ready (BD-7)
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
  v_actor            uuid := auth.uid();
  v_res              public.reservations%rowtype;
  v_deposit_centavos bigint;
  v_total_paid       bigint := 0;
  v_refundable       bigint;
  v_remaining_forfeit bigint;
  v_total_forfeited  bigint := 0;
  v_total_refund_req bigint := 0;
  v_next_pstatus     text;
  v_payment          record;
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

  v_deposit_centavos := round(coalesce(v_res.deposit, 0) * 100)::bigint;
  IF v_deposit_centavos <= 0 THEN RAISE EXCEPTION 'Cannot determine reservation deposit amount.' USING ERRCODE = 'check_violation'; END IF;

  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  v_refundable := greatest(0, v_total_paid - v_deposit_centavos);
  v_remaining_forfeit := least(v_deposit_centavos, v_total_paid);

  -- Forfeit up to v_deposit_centavos in aggregate, across payments
  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = _reservation_id AND status = 'paid' AND refund_disbursed_at IS NULL
    ORDER BY CASE WHEN purpose IN ('initial_deposit', 'full_payment') THEN 0 ELSE 1 END, created_at
    FOR UPDATE
  LOOP
    DECLARE
      v_row_forfeit bigint := 0;
      v_row_refund  bigint := 0;
    BEGIN
      IF v_remaining_forfeit > 0 THEN
        v_row_forfeit := least(v_remaining_forfeit, v_payment.amount_centavos);
        v_remaining_forfeit := v_remaining_forfeit - v_row_forfeit;
      END IF;
      v_row_refund := v_payment.amount_centavos - v_row_forfeit;

      UPDATE public.payments
      SET forfeited_centavos       = v_row_forfeit,
          refund_required_centavos = CASE WHEN v_row_refund > 0 THEN v_row_refund ELSE NULL END,
          requires_refund          = CASE WHEN v_row_refund > 0 THEN true ELSE false END,
          refund_required_at       = CASE WHEN v_row_refund > 0 THEN now() ELSE NULL END,
          updated_at               = now()
      WHERE id = v_payment.id;

      v_total_forfeited := v_total_forfeited + v_row_forfeit;
      v_total_refund_req := v_total_refund_req + v_row_refund;
    END;
  END LOOP;

  -- Assert aggregates
  IF v_total_forfeited <> least(v_deposit_centavos, v_total_paid) THEN
    RAISE EXCEPTION 'Forfeiture allocation mismatch: expected % but allocated %.', least(v_deposit_centavos, v_total_paid), v_total_forfeited;
  END IF;
  IF v_total_refund_req <> v_refundable THEN
    RAISE EXCEPTION 'Refund allocation mismatch: expected % but allocated %.', v_refundable, v_total_refund_req;
  END IF;

  v_next_pstatus := CASE WHEN v_refundable > 0 THEN 'Refund Required' ELSE 'Cancelled' END;

  UPDATE public.reservations
  SET status              = 'Cancelled',
      payment_status      = v_next_pstatus,
      cancellation_reason = 'Cancelled by customer after Ready',
      countdown           = false,
      updated_at          = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  INSERT INTO public.logs (user_id, action, target_type, target_id, details)
  VALUES (
    v_actor, 'customer_cancelled_after_ready', 'reservation', _reservation_id::text,
    jsonb_build_object('display_id', v_res.display_id, 'deposit_forfeited', v_total_forfeited, 'total_paid', v_total_paid, 'refundable', v_refundable, 'new_payment_status', v_next_pstatus)
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id, 'status', 'Cancelled', 'payment_status', v_next_pstatus,
    'deposit_forfeited_centavos', v_total_forfeited, 'refundable_centavos', v_refundable
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_reservation_after_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_after_ready(uuid) TO authenticated;

-- =============================================================================
-- 12. cancel_no_show_reservation
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
  v_res              public.reservations%rowtype;
  v_deposit_centavos bigint;
  v_total_paid       bigint := 0;
  v_refundable       bigint;
  v_remaining_forfeit bigint;
  v_total_forfeited  bigint := 0;
  v_total_refund_req bigint := 0;
  v_next_pstatus     text;
  v_payment          record;
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

  v_deposit_centavos := round(coalesce(v_res.deposit, 0) * 100)::bigint;

  SELECT coalesce(sum(p.amount_centavos), 0) INTO v_total_paid
  FROM public.payments p
  WHERE p.reservation_id = _reservation_id AND p.status = 'paid' AND p.refund_disbursed_at IS NULL;

  v_refundable := greatest(0, v_total_paid - v_deposit_centavos);
  v_remaining_forfeit := least(v_deposit_centavos, v_total_paid);

  FOR v_payment IN
    SELECT id, amount_centavos
    FROM public.payments
    WHERE reservation_id = _reservation_id AND status = 'paid' AND refund_disbursed_at IS NULL
    ORDER BY CASE WHEN purpose IN ('initial_deposit', 'full_payment') THEN 0 ELSE 1 END, created_at
    FOR UPDATE
  LOOP
    DECLARE
      v_row_forfeit bigint := 0;
      v_row_refund  bigint := 0;
    BEGIN
      IF v_remaining_forfeit > 0 THEN
        v_row_forfeit := least(v_remaining_forfeit, v_payment.amount_centavos);
        v_remaining_forfeit := v_remaining_forfeit - v_row_forfeit;
      END IF;
      v_row_refund := v_payment.amount_centavos - v_row_forfeit;

      UPDATE public.payments
      SET forfeited_centavos       = v_row_forfeit,
          refund_required_centavos = CASE WHEN v_row_refund > 0 THEN v_row_refund ELSE NULL END,
          requires_refund          = CASE WHEN v_row_refund > 0 THEN true ELSE false END,
          refund_required_at       = CASE WHEN v_row_refund > 0 THEN now() ELSE NULL END,
          updated_at               = now()
      WHERE id = v_payment.id;

      v_total_forfeited := v_total_forfeited + v_row_forfeit;
      v_total_refund_req := v_total_refund_req + v_row_refund;
    END;
  END LOOP;

  IF v_total_forfeited <> least(v_deposit_centavos, v_total_paid) THEN
    RAISE EXCEPTION 'Forfeiture allocation mismatch: expected % but allocated %.', least(v_deposit_centavos, v_total_paid), v_total_forfeited;
  END IF;
  IF v_total_refund_req <> v_refundable THEN
    RAISE EXCEPTION 'Refund allocation mismatch: expected % but allocated %.', v_refundable, v_total_refund_req;
  END IF;

  v_next_pstatus := CASE WHEN v_refundable > 0 THEN 'Refund Required' ELSE 'Cancelled' END;

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
    jsonb_build_object('display_id', v_res.display_id, 'pickup_deadline_at', v_res.pickup_deadline_at, 'deposit_forfeited', v_total_forfeited, 'refundable', v_refundable, 'new_payment_status', v_next_pstatus)
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id, 'status', 'Cancelled', 'payment_status', v_next_pstatus,
    'deposit_forfeited_centavos', v_total_forfeited, 'refundable_centavos', v_refundable
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_no_show_reservation(uuid) FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 13. sweep_pickup_deadlines (pg_cron, every 15 minutes)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sweep_pickup_deadlines()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      record;
  v_count    integer := 0;
  v_inserted bigint;
  v_total_paid bigint;
BEGIN
  FOR v_row IN
    SELECT r.id, r.customer_id, r.display_id, r.product_name, r.pickup_deadline_at, r.rental_price
    FROM public.reservations r
    WHERE coalesce(r.deleted, false) = false
      AND lower(trim(coalesce(r.status, ''))) IN ('ready', 'to pickup')
      AND r.pickup_deadline_at IS NOT NULL
      AND r.pickup_deadline_at < now()
      AND coalesce(r.extension_status, '') <> 'pending'
      AND r.pickup_terms_accepted_at IS NOT NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.notification_events_dedup (event_key)
    VALUES ('pickup_expired:' || v_row.id::text)
    ON CONFLICT (event_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN CONTINUE; END IF;

    SELECT coalesce(sum(amount_centavos), 0) INTO v_total_paid
    FROM public.payments
    WHERE reservation_id = v_row.id AND status = 'paid' AND refund_disbursed_at IS NULL;

    IF v_total_paid >= round(coalesce(v_row.rental_price, 0) * 100)::bigint THEN
      PERFORM public.mark_unclaimed_reservation(v_row.id);
      PERFORM public.enqueue_customer_notification(
        _user_id => v_row.customer_id,
        _title   => 'Reservation pickup overdue',
        _body    => coalesce(v_row.product_name, 'Your item') || ' is overdue for pickup. It has been marked as Unclaimed.',
        _type    => 'reservation',
        _data    => jsonb_build_object('reservation_id', v_row.id, 'display_id', v_row.display_id, 'event', 'pickup_expired')
      );
    ELSE
      PERFORM public.cancel_no_show_reservation(v_row.id);
      PERFORM public.enqueue_customer_notification(
        _user_id => v_row.customer_id,
        _title   => 'Reservation cancelled — pickup deadline passed',
        _body    => coalesce(v_row.product_name, 'Your item') || ' was not collected before the pickup deadline. Your reservation has been cancelled.',
        _type    => 'reservation',
        _data    => jsonb_build_object('reservation_id', v_row.id, 'display_id', v_row.display_id, 'event', 'pickup_expired')
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('processed', v_count, 'run_at', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_pickup_deadlines() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 14. Backfill existing Ready / To Pickup reservations
-- =============================================================================
UPDATE public.reservations
SET pickup_ready_at    = coalesce(updated_at, created_at),
    pickup_deadline_at = public.compute_pickup_deadline(coalesce(updated_at, created_at))
WHERE coalesce(deleted, false) = false
  AND lower(trim(coalesce(status, ''))) IN ('ready', 'to pickup')
  AND pickup_deadline_at IS NULL;

-- =============================================================================
-- 15. Allow handover of Unclaimed items
-- =============================================================================
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
  
  IF lower(coalesce(v_res.status, '')) NOT IN ('ready', 'to pickup', 'fitting', 'unclaimed') THEN
    RAISE EXCEPTION 'Only an item ready for pickup or unclaimed can be handed over.'
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
