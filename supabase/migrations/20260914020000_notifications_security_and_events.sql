-- ============================================================================
-- Migration: Notifications System Security Hardening & Missing Event Producers
--
-- 1. Canonical SECURITY DEFINER helper: enqueue_customer_notification(...)
-- 2. Table mutation hardening: customers can SELECT and UPDATE(is_read) on own rows;
--    INSERT/DELETE revoked; immutability trigger locks all other columns.
-- 3. Missing Event Producers:
--    - Receipt rejection with polite, customer-safe copy (no internal code leak).
--    - Support staff replies (auto-ack suppressed; chat transport is_read = true).
--    - Direct P2P chat messages (chat transport is_read = true).
--    - Review admin replies (fires on initial reply only).
-- 4. Normalization:
--    - Stock back-in-stock mapped to type 'product' and action 'back_in_stock'.
--    - Eliminate legacy rental wording in reservation notifications.
-- ============================================================================

-- 1. Canonical Ingestion Helper
CREATE OR REPLACE FUNCTION public.enqueue_customer_notification(
  _user_id uuid,
  _title text,
  _body text,
  _type text,
  _data jsonb DEFAULT NULL,
  _is_read boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (user_id, title, body, type, data, is_read)
  VALUES (_user_id, trim(_title), trim(_body), _type, _data, _is_read)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_customer_notification FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_customer_notification TO service_role;

-- 2. Table-level Mutation Hardening
DROP POLICY IF EXISTS "Users can manage their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update is_read on their own notifications" ON public.notifications;

CREATE POLICY "Users can view their own notifications"
ON public.notifications FOR SELECT TO authenticated
USING ((SELECT auth.uid() AS uid) = user_id);

CREATE POLICY "Users can update is_read on their own notifications"
ON public.notifications FOR UPDATE TO authenticated
USING ((SELECT auth.uid() AS uid) = user_id)
WITH CHECK ((SELECT auth.uid() AS uid) = user_id);

REVOKE INSERT, DELETE ON public.notifications FROM anon, authenticated, public;
REVOKE UPDATE ON public.notifications FROM anon, authenticated, public;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.harden_notifications_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff_or_admin() THEN
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.title := OLD.title;
    NEW.body := OLD.body;
    NEW.type := OLD.type;
    NEW.data := OLD.data;
    NEW.created_at := OLD.created_at;
    NEW.pushed_at := OLD.pushed_at;
    NEW.push_expired_at := OLD.push_expired_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_harden_notifications_update ON public.notifications;
CREATE TRIGGER trg_harden_notifications_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.harden_notifications_update();

-- 3. Receipt Rejection Notification in review_reservation_receipt
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
        payment_due_at = now() + make_interval(mins => v_retry_minutes),
        last_receipt_rejection_reason = _reason_code,
        last_receipt_rejected_at = now(),
        updated_at = now()
    WHERE id = _reservation_id
    RETURNING * INTO v_res;

    -- Customer-safe notification copy without leaking internal code
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
        'entity_type', 'reservation',
        'entity_id', v_res.id,
        'action', 'payment_rejected',
        'reservation_id', v_res.id,
        'display_id', v_res.display_id,
        'payment_issue', 'verification_failed',
        'deep_link', '/reservations/' || v_res.id
      ),
      _is_read => false
    );
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

-- 4. Support Staff Message Notification Trigger (auto-acks suppressed; is_read = true)
CREATE OR REPLACE FUNCTION public.notify_customer_on_support_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  -- Suppress automated responses from notifying/badging customer
  IF coalesce(NEW.is_auto_response, false) = true OR coalesce(NEW.sender_type, '') = 'auto_response' THEN
    RETURN NEW;
  END IF;

  -- Only genuine replies from boutique staff/admin/owner
  IF coalesce(NEW.sender_role, '') NOT IN ('staff', 'admin', 'owner') THEN
    RETURN NEW;
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_customer_id IS NOT NULL AND v_customer_id <> coalesce(NEW.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    PERFORM public.enqueue_customer_notification(
      _user_id => v_customer_id,
      _title   => 'New Message from Boutique Support',
      _body    => substring(coalesce(NEW.text, 'You have a new message from Boutique Support') from 1 for 120),
      _type    => 'conversation',
      _data    => jsonb_build_object(
        'entity_type', 'conversation',
        'entity_id', NEW.conversation_id,
        'action', 'new_message',
        'conversation_id', NEW.conversation_id,
        'actor_id', NEW.sender_id,
        'actor_name', coalesce(NEW.sender_name, 'Boutique Support'),
        'deep_link', '/messages/' || NEW.conversation_id
      ),
      _is_read => true -- Push transport row; is_read starts true to avoid duplicate badge
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_on_support_message ON public.messages;
CREATE TRIGGER trg_notify_customer_on_support_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_on_support_message();

-- 5. Direct P2P Chat Notification Trigger (is_read = true)
CREATE OR REPLACE FUNCTION public.notify_customer_on_direct_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id uuid;
  v_sender_name text;
BEGIN
  SELECT user_id INTO v_recipient_id
  FROM public.direct_chat_participants
  WHERE chat_id = NEW.chat_id AND user_id <> NEW.sender_id
  LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), username, 'Someone')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = NEW.sender_id;

  PERFORM public.enqueue_customer_notification(
    _user_id => v_recipient_id,
    _title   => coalesce(v_sender_name, 'New Message'),
    _body    => substring(coalesce(NEW.content, 'Sent you a message') from 1 for 120),
    _type    => 'direct_chat',
    _data    => jsonb_build_object(
      'entity_type', 'direct_chat',
      'entity_id', NEW.chat_id,
      'action', 'new_message',
      'direct_chat_id', NEW.chat_id,
      'actor_id', NEW.sender_id,
      'actor_name', v_sender_name,
      'deep_link', '/chat/' || NEW.sender_id
    ),
    _is_read => true -- Push transport row; is_read starts true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_on_direct_message ON public.direct_messages;
CREATE TRIGGER trg_notify_customer_on_direct_message
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_on_direct_message();

-- 6. Review Admin Reply Notification Trigger (initial reply only)
CREATE OR REPLACE FUNCTION public.notify_customer_on_review_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.admin_reply IS NULL AND NEW.admin_reply IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    PERFORM public.enqueue_customer_notification(
      _user_id => NEW.user_id,
      _title   => 'Response to your review',
      _body    => 'JezSy Collection replied: "' || substring(trim(NEW.admin_reply) from 1 for 100) || '"',
      _type    => 'review',
      _data    => jsonb_build_object(
        'entity_type', 'review',
        'entity_id', NEW.id,
        'action', 'review_reply',
        'review_id', NEW.id,
        'product_id', NEW.product_id,
        'deep_link', '/product/reviews?productId=' || NEW.product_id
      ),
      _is_read => false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_on_review_reply ON public.reviews;
CREATE TRIGGER trg_notify_customer_on_review_reply
  AFTER UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_on_review_reply();

-- 7. Stock Replenishment Normalization (type 'product', action 'back_in_stock')
CREATE OR REPLACE FUNCTION public.notify_stock_back_in_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_name text;
  r record;
BEGIN
  IF NEW.deleted OR NEW.product_doc_id IS NULL OR NEW.size IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (coalesce(OLD.available, 0) <= 0 AND coalesce(NEW.available, 0) > 0) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_doc_id;

  FOR r IN
    SELECT user_id FROM public.stock_notify_requests
    WHERE product_id = NEW.product_doc_id AND size = NEW.size
  LOOP
    PERFORM public.enqueue_customer_notification(
      _user_id => r.user_id,
      _title   => 'Back in Stock',
      _body    => coalesce(v_product_name, 'An item') || ' (size ' || NEW.size || ') is back in stock.',
      _type    => 'product',
      _data    => jsonb_build_object(
        'entity_type', 'product',
        'entity_id', NEW.product_doc_id,
        'action', 'back_in_stock',
        'product_id', NEW.product_doc_id,
        'size', NEW.size,
        'deep_link', '/product/' || NEW.product_doc_id
      ),
      _is_read => false
    );
  END LOOP;

  DELETE FROM public.stock_notify_requests
  WHERE product_id = NEW.product_doc_id AND size = NEW.size;

  RETURN NEW;
END;
$$;

-- 8. Reservation Status Copy Cleanup (Eliminate Rental Vocabulary)
CREATE OR REPLACE FUNCTION public.notify_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  ELSIF v_status = 'preparing' THEN
    v_title := 'Preparing your order';
    v_body := 'We are preparing ' || coalesce(NEW.product_name, 'your item') || ' for pickup.';
  ELSIF v_status IN ('to pickup', 'fitting', 'ready') THEN
    v_title := 'Ready for pickup';
    v_body := coalesce(NEW.product_name, 'Your item') || ' is ready for pickup at your boutique appointment.';
  ELSIF v_status = 'completed' THEN
    v_title := 'Order Complete';
    v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
               || ' is complete. Enjoy your new piece!';
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
      'entity_type', 'reservation',
      'entity_id', NEW.id,
      'action', 'status_changed',
      'reservation_id', NEW.id,
      'display_id', NEW.display_id,
      'status', NEW.status,
      'deep_link', '/reservations/' || NEW.id
    ),
    _is_read => false
  );

  RETURN NEW;
END;
$$;
