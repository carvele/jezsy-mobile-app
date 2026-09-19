-- Migration: 20260919160000_harden_messaging_and_admin_notification_triggers.sql
-- Description:
-- 1. Hardens set_message_sender_role() to canonically mark auto/system responses as 'system',
--    authoritatively lookup staff/owner/admin roles for sender_id, and assign 'system' for NULL sender_id
--    (never granting staff role based on sender_name string).
-- 2. Updates handle_auto_acknowledgment() to explicitly supply sender_role = 'system'.
-- 3. Hardens notify_admin_on_message() with early return for auto-responses and staff/system roles,
--    guarantees non-null notification text by construction, and provides narrow exception isolation
--    around the auxiliary admin notification write so primary messages never fail.

-- 1. Hardened set_message_sender_role()
CREATE OR REPLACE FUNCTION public.set_message_sender_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Canonical auto-response / system detection
  IF coalesce(NEW.is_auto_response, false) = true OR coalesce(NEW.sender_type, '') = 'auto_response' THEN
    NEW.sender_role := 'system';
    RETURN NEW;
  END IF;

  -- Authoritative database profile lookup when sender_id exists
  IF NEW.sender_id IS NOT NULL THEN
    SELECT CASE WHEN p.role IN ('staff', 'admin', 'owner') THEN 'staff' ELSE 'customer' END
    INTO NEW.sender_role
    FROM public.profiles p
    WHERE p.id = NEW.sender_id;

    IF NEW.sender_role IS NULL THEN
      NEW.sender_role := 'customer';
    END IF;
  ELSE
    -- sender_id is NULL: display strings never confer staff privilege; assign canonical system role
    NEW.sender_role := 'system';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_message_sender_role() FROM public, anon, authenticated;

-- 2. Explicit system metadata on handle_auto_acknowledgment()
CREATE OR REPLACE FUNCTION public.handle_auto_acknowledgment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  setting_enabled BOOLEAN := TRUE;
  setting_message TEXT := 'Thank you for your message! We have received it and notified the Jezsy Staff. Please wait patiently while a staff member reviews your message and responds to you. 💕';
  setting_row RECORD;
  last_staff_time TIMESTAMPTZ;
  existing_auto_count INT := 0;
BEGIN
  IF NEW.is_auto_response IS TRUE OR NEW.sender_type = 'auto_response' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.sender_id AND role IN ('staff', 'admin', 'owner') AND deleted IS DISTINCT FROM true
  ) THEN
    RETURN NEW;
  END IF;

  SELECT (value->>'enabled')::boolean AS enabled, value->>'message' AS message
  INTO setting_row
  FROM public.settings
  WHERE key = 'autoReply';

  IF FOUND THEN
    IF setting_row.enabled IS FALSE THEN
      RETURN NEW;
    END IF;
    IF setting_row.message IS NOT NULL AND TRIM(setting_row.message) <> '' THEN
      setting_message := setting_row.message;
    END IF;
  END IF;

  SELECT MAX(created_at) INTO last_staff_time
  FROM public.messages
  WHERE conversation_id = NEW.conversation_id
    AND sender_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = messages.sender_id AND role IN ('staff', 'admin', 'owner') AND deleted IS DISTINCT FROM true
    );

  SELECT COUNT(*) INTO existing_auto_count
  FROM public.messages
  WHERE conversation_id = NEW.conversation_id
    AND (is_auto_response IS TRUE OR sender_type = 'auto_response')
    AND (last_staff_time IS NULL OR created_at >= last_staff_time);

  IF existing_auto_count > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    sender_name,
    text,
    is_auto_response,
    sender_type,
    sender_role,
    created_at
  ) VALUES (
    NEW.conversation_id,
    NULL,
    'Jezsy System',
    setting_message,
    TRUE,
    'auto_response',
    'system',
    NOW() + INTERVAL '10 milliseconds'
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_auto_acknowledgment() FROM public, anon, authenticated;

-- 3. Hardened notify_admin_on_message()
CREATE OR REPLACE FUNCTION public.notify_admin_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_customer_name TEXT := 'A customer';
BEGIN
    -- Guard 1: Early return for automated responses, staff, and system messages
    IF coalesce(NEW.is_auto_response, false) = true
       OR coalesce(NEW.sender_type, '') = 'auto_response'
       OR coalesce(NEW.sender_role, '') IN ('staff', 'admin', 'owner', 'system') THEN
        RETURN NEW;
    END IF;

    -- Guard 2: Safe profile name lookup only when sender_id is present
    IF NEW.sender_id IS NOT NULL THEN
        SELECT COALESCE(
          nullif(trim(full_name), ''),
          nullif(trim(concat_ws(' ', first_name, last_name)), ''),
          'A customer'
        )
        INTO v_customer_name
        FROM public.profiles
        WHERE id = NEW.sender_id;
    END IF;

    -- Guard 3: Non-null text guaranteed by construction
    v_customer_name := COALESCE(nullif(trim(v_customer_name), ''), 'A customer');

    -- Guard 4: Narrow exception isolation around auxiliary admin notification write
    BEGIN
        INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id, event_key)
        VALUES (
            'New Message',
            v_customer_name || ' sent a new message.',
            'Message',
            'message',
            NEW.conversation_id::text,
            'msg_insert_' || NEW.id::text
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_admin_on_message: failed to record admin notification for message_id=%, conv_id=%, sqlstate=%, sqlerrm=%',
            NEW.id, NEW.conversation_id, SQLSTATE, SQLERRM;
    END;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admin_on_message() FROM public, anon, authenticated;
