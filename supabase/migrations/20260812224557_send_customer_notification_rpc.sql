-- owner-dashboard's SendNotificationModal.jsx calls a nonexistent 'send-push'
-- edge function, then falls back to a plain client insert into
-- public.notifications -- which the table's only RLS policy ("Users can
-- manage their own notifications", USING/WITH CHECK auth.uid() = user_id)
-- always rejects, since the inserting session is staff, not the target
-- customer. The fallback's error return value was never checked, so staff
-- always saw "Push notification sent!" regardless -- the feature has been
-- silently 100% non-functional. Also the fallback insert used a 'read'
-- column that doesn't exist (real column: is_read) and omitted the NOT NULL
-- 'type' column, so it would have failed on those grounds even without RLS.
--
-- This RPC gives staff a real, authorized way to write into a customer's
-- notifications row. dispatch_pending_push() (existing cron, unrelated to
-- this fix) already picks up any row with pushed_at IS NULL and an
-- expo_push_token and sends it via Expo -- so a row inserted here is
-- actually delivered as a push, not just recorded.
CREATE OR REPLACE FUNCTION public.send_customer_notification(_user_id uuid, _title text, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_notification_id uuid;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff can send customer notifications.';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'A recipient is required.';
  END IF;
  IF coalesce(trim(_title), '') = '' OR coalesce(trim(_body), '') = '' THEN
    RAISE EXCEPTION 'Title and message are required.';
  END IF;

  INSERT INTO public.notifications (user_id, title, body, type)
  VALUES (_user_id, trim(_title), trim(_body), 'staff_message')
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_customer_notification(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_customer_notification(uuid, text, text) TO authenticated;
