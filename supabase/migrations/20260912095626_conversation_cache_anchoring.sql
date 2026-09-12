-- Migration: Conversation Cache Anchoring & Historical Backfill
-- M4: Anchors conversations.last_message_id to messages(id), backfills historical conversations,
-- and replaces sync_conversation_on_message trigger with deterministic ordering,
-- null-safe sender comparison, edit synchronization, and unread decrement on delete.

-- 1. Add last_message_id foreign key column
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_id
  ON public.conversations(last_message_id);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created_desc
  ON public.messages(conversation_id, created_at DESC, id DESC);

-- 2. Deterministic historical backfill for existing conversations
UPDATE public.conversations c
SET last_message_id = latest.id,
    last_message = COALESCE(
      NULLIF(latest.text, ''),
      CASE WHEN latest.image_url IS NOT NULL THEN 'Sent an image' ELSE NULL END
    ),
    last_message_time = latest.created_at
FROM (
  SELECT DISTINCT ON (conversation_id) id, conversation_id, text, image_url, created_at
  FROM public.messages
  ORDER BY conversation_id, created_at DESC, id DESC
) latest
WHERE c.id = latest.conversation_id;

-- 3. Robust trigger function handling INSERT, UPDATE, and DELETE
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

    -- System messages (sender_id IS NULL) or staff messages (sender_id != customer_id) -> customer unread
    -- Customer messages (sender_id = customer_id) -> staff unread
    IF NEW.sender_id IS DISTINCT FROM v_customer_id THEN
      v_unread_customer_delta := 1;
      v_unread_staff_delta := 0;
    ELSE
      v_unread_customer_delta := 0;
      v_unread_staff_delta := 1;
    END IF;

    v_preview := COALESCE(
      NULLIF(NEW.text, ''),
      CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE NULL END
    );

    -- Only advance preview/time cache if NEW is at least as recent as current cache
    IF v_last_time IS NULL OR NEW.created_at >= v_last_time THEN
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
    -- If content changed and this message is currently the cached preview, sync the conversation preview
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

    -- If the deleted message was unread, decrement the corresponding counter down to 0
    IF OLD.read_at IS NULL THEN
      IF OLD.sender_id IS DISTINCT FROM v_customer_id THEN
        v_unread_customer_delta := -1;
      ELSE
        v_unread_staff_delta := -1;
      END IF;
    END IF;

    -- If the deleted message was the cached latest message, find previous newest message
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
      -- Deleted message was not the latest; apply unread counter decrement if unread
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

-- 4. Recreate trigger on messages for INSERT, UPDATE, and DELETE
DROP TRIGGER IF EXISTS trg_sync_conversation_on_message ON public.messages;

CREATE TRIGGER trg_sync_conversation_on_message
AFTER INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_conversation_on_message();
