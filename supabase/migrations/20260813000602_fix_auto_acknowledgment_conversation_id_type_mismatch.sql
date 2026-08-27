-- handle_auto_acknowledgment() (AFTER INSERT trigger on messages) had
-- "WHERE id::text = NEW.conversation_id OR custom_id = NEW.conversation_id".
-- messages.conversation_id is uuid, so id::text = NEW.conversation_id
-- compares text to uuid -- "operator does not exist: text = uuid" (42883).
-- conversations.custom_id doesn't exist as a column at all anymore either.
-- Since this trigger runs AFTER INSERT and the exception was unhandled, it
-- rolled back the entire message insert -- every customer's first message in
-- a conversation (or first after a staff reply) was failing to send whenever
-- autoReply was enabled. Fixed to the correct uuid = uuid comparison.
CREATE OR REPLACE FUNCTION public.handle_auto_acknowledgment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    WHERE id = NEW.sender_id AND role IN ('staff', 'owner') AND deleted IS DISTINCT FROM true
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
      WHERE id = messages.sender_id AND role IN ('staff', 'owner') AND deleted IS DISTINCT FROM true
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
    created_at
  ) VALUES (
    NEW.conversation_id,
    NULL,
    'Jezsy System',
    setting_message,
    TRUE,
    'auto_response',
    NOW() + INTERVAL '10 milliseconds'
  );

  UPDATE public.conversations
  SET last_message = setting_message,
      last_message_time = NOW(),
      updated_at = NOW()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$function$;
