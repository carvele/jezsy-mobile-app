-- Rollback for 20260720230000_unread_count_trigger.sql
-- Restores the pre-increment trigger body and drops the INSERT guard.

DROP TRIGGER IF EXISTS trg_force_conversation_unread_zero ON public.conversations;
DROP FUNCTION IF EXISTS public.force_conversation_unread_zero();

CREATE OR REPLACE FUNCTION public.sync_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.conversations
  SET
    last_message = COALESCE(
      NULLIF(NEW.text, ''),
      CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE last_message END
    ),
    last_message_time = COALESCE(NEW.created_at, now())
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;
