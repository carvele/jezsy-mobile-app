-- Fixes two confirmed customer-notification gaps in the reservation workflow,
-- found by tracing the live state machine end to end, plus removes dead status
-- vocabulary ('preparing', 'ready') left over from an earlier rename that the
-- current reservations_status_check constraint no longer allows.
--
-- 1. settle_payment_webhook() -- the function the PayMongo webhook calls on a
--    successful GCash payment -- only ever updated payment_status, never
--    status. notify_reservation_status_change() is gated on `status` actually
--    changing and early-returns otherwise, so it never fired for a payment
--    event: a customer got no notification once their payment settled unless
--    they stayed on the in-app polling screen through the whole flow. Fixed by
--    inserting the notification directly in settle_payment_webhook() instead
--    of touching the trigger's gating logic, since status genuinely doesn't
--    (and per docs/paymongo-setup.md, shouldn't) change on payment alone.
--
-- 2. notify_reservation_status_change() sent the identical "Ready for pickup"
--    notification for 'to pickup', 'fitting', AND 'active' -- but 'active' is
--    the handover status; the customer already has the item at that point.
--    Split into its own correct message.
--
-- 3. settle_reservation_balance() (staff settling the remaining balance after
--    a deposit, e.g. cash/card at pickup) sent no notification at all. Added
--    one for consistency, even though this is typically an in-person action.
--
-- 4. Removed 'preparing'/'ready' from notify_reservation_status_change()'s and
--    reservation_holds_stock()'s status lists. Both are unreachable dead code:
--    the live reservations_status_check constraint (see
--    20260813140000_defuse_schema_harmonization_status_vocab.sql) only allows
--    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
--    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled' -- a row can
--    never actually contain 'Preparing' or 'Ready'.
--
-- All three functions replaced via CREATE OR REPLACE, preserving their exact
-- signatures so existing trigger bindings and RPC grants are untouched.

CREATE OR REPLACE FUNCTION public.settle_payment_webhook(_payment_id uuid, _next_status text, _method text, _provider_payment_id text, _event_id text, _event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment public.payments%rowtype;
  v_res record;
BEGIN
  IF _next_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Unsupported payment status.';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = _payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;

  IF v_payment.last_event_id = _event_id THEN
    RETURN jsonb_build_object('duplicate', true, 'status', v_payment.status);
  END IF;

  IF v_payment.status = 'paid' AND _next_status <> 'paid' THEN
    RETURN jsonb_build_object('ignored', 'already paid', 'status', v_payment.status);
  END IF;

  UPDATE public.payments
  SET status = _next_status,
      method = COALESCE(_method, method),
      provider_payment_id = COALESCE(_provider_payment_id, provider_payment_id),
      last_event_id = _event_id,
      last_event = _event
  WHERE id = _payment_id;

  IF _next_status = 'paid' AND v_payment.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET payment_status = 'Paid', updated_at = now()
    WHERE id = v_payment.reservation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found for payment.'; END IF;

    SELECT customer_id, product_name, display_id INTO v_res
    FROM public.reservations WHERE id = v_payment.reservation_id;

    IF v_res.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_res.customer_id, 'reservation', 'Payment received',
        'Your payment for ' || coalesce(v_res.product_name, 'your item') || ' has been received.',
        jsonb_build_object('reservation_id', v_payment.reservation_id, 'display_id', v_res.display_id, 'payment_status', 'Paid')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('status', _next_status);
END;
$function$;

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
  ELSIF v_status IN ('to pickup', 'fitting') THEN
    v_title := 'Ready for pickup';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is ready for pickup at your appointment.';
  ELSIF v_status = 'active' THEN
    v_title := 'Enjoy your rental';
    v_body := coalesce(NEW.product_name, 'Your item') || ' has been checked out to you. Have a great time!';
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

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (NEW.customer_id, 'reservation', v_title, v_body,
    jsonb_build_object('reservation_id', NEW.id, 'display_id', NEW.display_id, 'status', NEW.status));

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT coalesce(_deleted, false)
     AND lower(trim(coalesce(_status, ''))) IN ('approved', 'confirmed', 'to pay', 'to pickup', 'fitting', 'active');
$function$;

CREATE OR REPLACE FUNCTION public.settle_reservation_balance(_reservation_id uuid, _method text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res record;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  IF lower(COALESCE(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The deposit has not been paid yet.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = COALESCE(v_actor_name, 'Staff'),
      balance_settled_method = _method
  WHERE id = _reservation_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    v_actor, COALESCE(v_actor_name, 'Staff'), 'Settled reservation balance',
    'reservation', _reservation_id::text,
    jsonb_build_object('amount', v_outstanding, 'method', _method, 'display_id', v_res.display_id)
  );

  IF v_res.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_res.customer_id, 'reservation', 'Balance settled',
      'The remaining balance for ' || coalesce(v_res.product_name, 'your item') || ' has been paid in full.',
      jsonb_build_object('reservation_id', _reservation_id, 'display_id', v_res.display_id, 'amount', v_outstanding)
    );
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;
