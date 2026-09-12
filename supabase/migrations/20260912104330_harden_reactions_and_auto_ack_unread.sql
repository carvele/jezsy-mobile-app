-- Migration: Harden Reactions Signature and Auto-Ack Unread Handling
-- 1. Create canonical 2-argument merge_message_reaction(p_message_id, p_emoji)
-- 2. Update 3-argument merge_message_reaction to proxy to 2-arg version
-- 3. Update sync_conversation_on_message to explicitly ignore auto-acknowledgements for unread counts
-- 4. Clean handle_auto_acknowledgment to remove redundant manual conversation update

-- 1. Canonical 2-argument merge_message_reaction
CREATE OR REPLACE FUNCTION public.merge_message_reaction(
  p_message_id uuid,
  p_emoji text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current jsonb;
  v_result jsonb;
  v_actor_id text;
BEGIN
  IF p_emoji IS NULL OR p_emoji = '' THEN
    RAISE EXCEPTION 'p_emoji is required.';
  END IF;

  v_actor_id := (SELECT auth.uid())::text;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Participant membership authorization check
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = p_message_id
      AND (c.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
  ) THEN
    RAISE EXCEPTION 'Message not found or unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT reactions INTO v_current FROM public.messages WHERE id = p_message_id;
  v_current := coalesce(v_current, '{}'::jsonb);

  IF v_current ->> v_actor_id = p_emoji THEN
    v_result := v_current - v_actor_id;
  ELSE
    v_result := v_current || jsonb_build_object(v_actor_id, p_emoji);
  END IF;

  UPDATE public.messages SET reactions = v_result WHERE id = p_message_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text) TO authenticated;

-- 2. Proxy 3-argument merge_message_reaction to canonical 2-arg version
CREATE OR REPLACE FUNCTION public.merge_message_reaction(
  p_message_id uuid,
  p_user_id text,
  p_emoji text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.merge_message_reaction(p_message_id, p_emoji);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) TO authenticated;

-- 3. Update sync_conversation_on_message with explicit auto-ack unread handling
CREATE OR REPLACE FUNCTION public.sync_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_last_time timestamptz;
  v_last_id uuid;
  v_preview text;
  v_prev_id uuid;
  v_prev_text text;
  v_prev_image text;
  v_prev_created_at timestamptz;
  v_unread_customer_delta int := 0;
  v_unread_staff_delta int := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT customer_id, last_message_time, last_message_id
    INTO v_customer_id, v_last_time, v_last_id
    FROM public.conversations
    WHERE id = NEW.conversation_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- Unread counter update:
    -- Auto-acknowledgments (is_auto_response = true) do NOT increment unread_customer
    IF coalesce(NEW.is_auto_response, false) IS TRUE OR coalesce(NEW.sender_type, '') = 'auto_response' THEN
      v_unread_customer_delta := 0;
      v_unread_staff_delta := 0;
    ELSIF NEW.sender_id IS DISTINCT FROM v_customer_id THEN
      -- Genuine staff / boutique message -> increment customer unread
      v_unread_customer_delta := 1;
      v_unread_staff_delta := 0;
    ELSE
      -- Customer message -> increment staff unread
      v_unread_customer_delta := 0;
      v_unread_staff_delta := 1;
    END IF;

    v_preview := COALESCE(
      NULLIF(NEW.text, ''),
      CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE NULL END
    );

    -- Advance cache if NEW is newer than current cache or breaks ties by id
    IF v_last_time IS NULL
       OR NEW.created_at > v_last_time
       OR (NEW.created_at = v_last_time AND (v_last_id IS NULL OR NEW.id >= v_last_id))
    THEN
      UPDATE public.conversations
      SET last_message_id = NEW.id,
          last_message = v_preview,
          last_message_time = COALESCE(NEW.created_at, now()),
          unread_customer = COALESCE(unread_customer, 0) + v_unread_customer_delta,
          unread_staff = COALESCE(unread_staff, 0) + v_unread_staff_delta,
          updated_at = now()
      WHERE id = NEW.conversation_id;
    ELSE
      UPDATE public.conversations
      SET unread_customer = COALESCE(unread_customer, 0) + v_unread_customer_delta,
          unread_staff = COALESCE(unread_staff, 0) + v_unread_staff_delta,
          updated_at = now()
      WHERE id = NEW.conversation_id;
    END IF;

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.text IS DISTINCT FROM OLD.text OR NEW.image_url IS DISTINCT FROM OLD.image_url) THEN
      SELECT last_message_id INTO v_last_id
      FROM public.conversations
      WHERE id = NEW.conversation_id;

      IF v_last_id = NEW.id THEN
        v_preview := COALESCE(
          NULLIF(NEW.text, ''),
          CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE NULL END
        );

        UPDATE public.conversations
        SET last_message = v_preview,
            updated_at = now()
        WHERE id = NEW.conversation_id;
      END IF;
    END IF;

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT customer_id, last_message_id
    INTO v_customer_id, v_last_id
    FROM public.conversations
    WHERE id = OLD.conversation_id;

    IF NOT FOUND THEN
      RETURN OLD;
    END IF;

    -- Decrement unread counter only if deleted message was unread and not an auto-response
    IF OLD.read_at IS NULL THEN
      IF coalesce(OLD.is_auto_response, false) IS TRUE OR coalesce(OLD.sender_type, '') = 'auto_response' THEN
        v_unread_customer_delta := 0;
        v_unread_staff_delta := 0;
      ELSIF OLD.sender_id IS DISTINCT FROM v_customer_id THEN
        v_unread_customer_delta := -1;
      ELSE
        v_unread_staff_delta := -1;
      END IF;
    END IF;

    -- If deleted message was the cached latest message, roll back to previous latest message
    IF v_last_id = OLD.id OR v_last_id IS NULL THEN
      SELECT id, text, image_url, created_at
      INTO v_prev_id, v_prev_text, v_prev_image, v_prev_created_at
      FROM public.messages
      WHERE conversation_id = OLD.conversation_id
        AND id != OLD.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF FOUND THEN
        v_preview := COALESCE(
          NULLIF(v_prev_text, ''),
          CASE WHEN v_prev_image IS NOT NULL THEN 'Sent an image' ELSE NULL END
        );

        UPDATE public.conversations
        SET last_message_id = v_prev_id,
            last_message = v_preview,
            last_message_time = v_prev_created_at,
            unread_customer = GREATEST(0, COALESCE(unread_customer, 0) + v_unread_customer_delta),
            unread_staff = GREATEST(0, COALESCE(unread_staff, 0) + v_unread_staff_delta),
            updated_at = now()
        WHERE id = OLD.conversation_id;
      ELSE
        -- No remaining messages
        UPDATE public.conversations
        SET last_message_id = NULL,
            last_message = NULL,
            last_message_time = NULL,
            unread_customer = GREATEST(0, COALESCE(unread_customer, 0) + v_unread_customer_delta),
            unread_staff = GREATEST(0, COALESCE(unread_staff, 0) + v_unread_staff_delta),
            updated_at = now()
        WHERE id = OLD.conversation_id;
      END IF;
    ELSE
      IF v_unread_customer_delta != 0 OR v_unread_staff_delta != 0 THEN
        UPDATE public.conversations
        SET unread_customer = GREATEST(0, COALESCE(unread_customer, 0) + v_unread_customer_delta),
            unread_staff = GREATEST(0, COALESCE(unread_staff, 0) + v_unread_staff_delta),
            updated_at = now()
        WHERE id = OLD.conversation_id;
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 4. Clean handle_auto_acknowledgment to remove redundant conversation overwrite
CREATE OR REPLACE FUNCTION public.handle_auto_acknowledgment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    created_at
  ) VALUES (
    NEW.conversation_id,
    NULL,
    'Jezsy System',
    setting_message,
    TRUE,
    'auto_response',
    NEW.created_at + INTERVAL '10 milliseconds'
  );

  RETURN NEW;
END;
$$;
