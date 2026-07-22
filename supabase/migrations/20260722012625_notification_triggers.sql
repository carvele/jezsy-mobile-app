-- Fix: nothing anywhere ever inserted into public.notifications, so the
-- Notifications tab in Inbox (app/(tabs)/messages.tsx) was permanently
-- empty for every user. Add triggers that generate a notification when a
-- reservation or order's status changes.
--
-- Scope deliberately excludes:
--   - messages: a new chat message already surfaces via the Messages tab's
--     unread badge and conversation preview; duplicating every message as
--     a Notifications-tab entry too would be redundant, not helpful.
--   - promo: marketing broadcasts need staff-initiated tooling to compose
--     and target them, not an automatic DB trigger.
--
-- Both reservations and orders are staff-only writes (RLS: "Enable update
-- for admin only" / "Enable write for staff only"), so these triggers use
-- SECURITY DEFINER to insert on behalf of the customer regardless of the
-- acting staff member's own grants on public.notifications.

CREATE OR REPLACE FUNCTION public.notify_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE lower(coalesce(NEW.status, ''))
    WHEN 'confirmed' THEN
      v_title := 'Reservation Confirmed';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' on ' || to_char(NEW.date, 'Mon DD, YYYY') || ' has been confirmed.';
    WHEN 'completed' THEN
      v_title := 'Reservation Completed';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' is complete. We hope you loved it!';
    WHEN 'cancelled' THEN
      v_title := 'Reservation Cancelled';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' has been cancelled.';
    ELSE
      v_title := 'Reservation Updated';
      v_body := 'Your reservation for ' || coalesce(NEW.product_name, 'your item')
                 || ' is now ' || NEW.status || '.';
  END CASE;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.customer_id,
    'reservation',
    v_title,
    v_body,
    jsonb_build_object('reservation_id', NEW.id, 'display_id', NEW.display_id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_reservation_status_change ON public.reservations;
CREATE TRIGGER trg_notify_reservation_status_change
AFTER UPDATE ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.notify_reservation_status_change();

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE lower(coalesce(NEW.status, ''))
    WHEN 'processing' THEN
      v_title := 'Order Processing';
      v_body := 'Your order ' || coalesce(NEW.display_id, '') || ' is being processed.';
    WHEN 'shipped' THEN
      v_title := 'Order Shipped';
      v_body := 'Your order ' || coalesce(NEW.display_id, '') || ' is on its way.';
    WHEN 'delivered' THEN
      v_title := 'Order Delivered';
      v_body := 'Your order ' || coalesce(NEW.display_id, '') || ' has been delivered.';
    WHEN 'cancelled' THEN
      v_title := 'Order Cancelled';
      v_body := 'Your order ' || coalesce(NEW.display_id, '') || ' has been cancelled.';
    ELSE
      v_title := 'Order Updated';
      v_body := 'Your order ' || coalesce(NEW.display_id, '') || ' is now ' || NEW.status || '.';
  END CASE;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.customer_id,
    'order',
    v_title,
    v_body,
    jsonb_build_object('order_id', NEW.id, 'display_id', NEW.display_id, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_status_change ON public.orders;
CREATE TRIGGER trg_notify_order_status_change
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_order_status_change();
