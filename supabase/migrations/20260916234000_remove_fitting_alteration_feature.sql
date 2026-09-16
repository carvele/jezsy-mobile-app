-- Migration: 20260916234000_remove_fitting_alteration_feature.sql
-- Description:
-- 1. Explicitly drop RLS policies, tables (reservation_item_alterations, reservation_fitting_records),
--    and the 4 alteration/fitting RPCs:
--    - save_reservation_fitting_record
--    - save_reservation_item_alteration
--    - get_customer_reservation_fitting
--    - can_manage_fitting_records
-- 2. Retire 'Fitting' status from reservations_status_check constraint.
-- 3. Update status guards and helpers to remove 'Fitting':
--    - guard_reservation_financial_state
--    - complete_reservation_handover
--    - request_reschedule
--    - reservation_holds_stock
--    - notify_reservation_status_change
--    - recalculate_inventory_stock

-- ── 1. Drop Tables and RPCs ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff_manage_item_alterations" ON public.reservation_item_alterations;
DROP POLICY IF EXISTS "staff_manage_fitting_records" ON public.reservation_fitting_records;

DROP TABLE IF EXISTS public.reservation_item_alterations CASCADE;
DROP TABLE IF EXISTS public.reservation_fitting_records CASCADE;

DROP FUNCTION IF EXISTS public.save_reservation_fitting_record(uuid, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.save_reservation_item_alteration(uuid, uuid, uuid, numeric, numeric, numeric, numeric, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.get_customer_reservation_fitting(uuid);
DROP FUNCTION IF EXISTS public.can_manage_fitting_records();

-- ── 2. Retire 'Fitting' Status Constraint ───────────────────────────────────

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'Preparing', 'Ready', 'To Pickup', 'Active', 'Completed', 'Cancelled'
  )) NOT VALID;

-- ── 3. Update reservation_holds_stock ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT coalesce(_deleted, false)
     AND lower(trim(coalesce(_status, ''))) IN (
       'approved', 'confirmed', 'to pay', 'preparing', 'ready', 'to pickup', 'active'
     );
$function$;

-- ── 4. Update guard_reservation_financial_state ──────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  -- Block direct authenticated client status/payment_status writes.
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
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) = 'completed' THEN

    -- Previous status must be a Ready-equivalent state (Fitting retired).
    IF lower(coalesce(OLD.status, '')) NOT IN ('ready', 'to pickup', 'active') THEN
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

REVOKE EXECUTE ON FUNCTION public.guard_reservation_financial_state()
  FROM PUBLIC, anon, authenticated;

-- ── 5. Update complete_reservation_handover ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_reservation_handover(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res reservations%rowtype;
  v_actor uuid := auth.uid();
  v_actor_name text;
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

  -- Fitting retired from handover prerequisites.
  IF lower(coalesce(v_res.status, '')) NOT IN ('ready', 'to pickup') THEN
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
    v_actor_name,
    'Completed reservation pickup',
    'reservation',
    _reservation_id::text,
    jsonb_build_object(
      'display_id', v_res.display_id,
      'previous_status', v_previous_status,
      'new_status', 'Completed',
      'payment_status', v_res.payment_status,
      'deposit', v_res.deposit,
      'rental_price', v_res.rental_price,
      'balance_settled_at', v_res.balance_settled_at
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'status', 'Completed',
    'previous_status', v_previous_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_reservation_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_reservation_handover(uuid) TO authenticated;

-- ── 6. Update request_reschedule ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_reschedule(
  _reservation_id   uuid,
  _date             date,
  _appointment_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res         public.reservations%rowtype;
  v_status      text;
  v_appointment timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id
    AND customer_id = auth.uid()
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_status := lower(COALESCE(v_res.status, 'pending'));

  -- Fitting retired from reschedule eligibility.
  IF v_status NOT IN ('pending', 'request approval', 'confirmed', 'approved', 'to pay', 'to pickup', 'ready') THEN
    RAISE EXCEPTION 'This reservation can no longer be rescheduled.';
  END IF;

  IF v_res.reschedule_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a reschedule request waiting for review.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  PERFORM public.assert_bookable_slot(_date::date, v_appointment, _reservation_id);

  UPDATE public.reservations
  SET reschedule_requested_date    = _date::date,
      reschedule_requested_at_time = v_appointment,
      reschedule_requested_at      = now()
  WHERE id = _reservation_id
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'reservation_id',              v_res.id,
    'reschedule_requested_date',    v_res.reschedule_requested_date,
    'reschedule_requested_at_time', v_res.reschedule_requested_at_time,
    'reschedule_requested_at',      v_res.reschedule_requested_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_reschedule(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_reschedule(uuid, date, time) TO authenticated;

-- ── 7. Update notify_reservation_status_change ───────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text; v_body text;
  v_status text := lower(coalesce(NEW.status, ''));
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  IF v_status IN ('confirmed', 'approved', 'to pay') THEN
    IF lower(coalesce(NEW.payment_status, '')) = 'paid' THEN
      v_title := 'Reservation Confirmed';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' on ' || to_char(NEW.date, 'Mon DD, YYYY') || ' is confirmed.';
    ELSE
      v_title := 'Accepted - payment needed';
      v_body := coalesce(NEW.product_name, 'Your item') || ' has been accepted. Pay by '
                 || to_char(NEW.payment_due_at AT TIME ZONE 'Asia/Manila', 'Mon DD, HH12:MI AM')
                 || ' to keep it.';
    END IF;
  ELSIF v_status IN ('to pickup', 'ready') THEN
    v_title := 'Ready for pickup';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is ready for pickup at your appointment.';
  ELSIF v_status = 'active' THEN
    v_title := 'Order Active';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is active.';
  ELSIF v_status = 'completed' THEN
    v_title := 'Reservation Completed';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is complete. We hope you loved it!';
  ELSIF v_status = 'cancelled' THEN
    IF lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'submitted')
       AND NEW.payment_due_at IS NOT NULL AND NEW.payment_due_at <= now() THEN
      v_title := 'Reservation Expired';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' was cancelled because payment was not received in time.';
    ELSE
      v_title := 'Reservation Cancelled';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' has been cancelled.';
    END IF;
  ELSE
    v_title := 'Reservation Updated';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is now ' || NEW.status || '.';
  END IF;

  PERFORM public.enqueue_customer_notification(
    _user_id => NEW.customer_id,
    _title   => v_title,
    _body    => v_body,
    _type    => 'reservation',
    _data    => jsonb_build_object(
      'reservation_id', NEW.id,
      'status', NEW.status,
      'payment_status', NEW.payment_status
    )
  );

  RETURN NEW;
END;
$function$;

-- ── 8. Update recalculate_inventory_stock ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recalculate_inventory_stock()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inventory_count integer;
  v_product_count integer;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'staff role required';
  END IF;

  WITH calculated AS (
    SELECT i.id,
           COALESCE(SUM(r.quantity), 0)::integer AS reserved
    FROM public.inventory i
    LEFT JOIN public.reservations r
      ON r.size = i.size
     AND (r.product_id = i.product_doc_id OR r.product_id::text = i.sku OR r.product_name = i.item)
     AND r.status IN ('Approved', 'Confirmed', 'To Pay', 'Preparing', 'To Pickup', 'Active', 'Ready')
    WHERE COALESCE(i.deleted, false) = false
    GROUP BY i.id
  ), updated AS (
    UPDATE public.inventory i
       SET reserved = c.reserved,
           available = GREATEST(0, COALESCE(i.total, 0) - c.reserved),
           updated_at = now()
      FROM calculated c
     WHERE i.id = c.id
    RETURNING i.id
  )
  SELECT count(*) INTO v_inventory_count FROM updated;

  WITH totals AS (
    SELECT i.product_doc_id,
           COALESCE(SUM(i.available), 0)::integer AS available,
           COALESCE(SUM(i.reserved), 0)::integer AS reserved
      FROM public.inventory i
     WHERE COALESCE(i.deleted, false) = false
       AND i.product_doc_id IS NOT NULL
     GROUP BY i.product_doc_id
  ), updated AS (
    UPDATE public.products p
       SET stock = t.available,
           status = CASE WHEN t.available <= 0 THEN CASE WHEN t.reserved > 0 THEN 'Reserved' ELSE 'Out of Stock' END ELSE 'In Boutique' END,
           updated_at = now()
      FROM totals t
     WHERE p.id = t.product_doc_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_product_count FROM updated;

  RETURN jsonb_build_object('inventory_rows', v_inventory_count, 'products', v_product_count);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_inventory_stock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_stock() TO authenticated;
