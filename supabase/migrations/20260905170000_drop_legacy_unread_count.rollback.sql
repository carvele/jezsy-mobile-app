ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.force_conversation_unread_zero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.unread_count := 0;
  NEW.unread_customer := 0;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.conversations c
  SET
    last_message = COALESCE(
      NULLIF(NEW.text, ''),
      CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE c.last_message END
    ),
    last_message_time = COALESCE(NEW.created_at, now()),
    unread_customer = CASE
      WHEN NEW.sender_id IS DISTINCT FROM c.customer_id
        THEN COALESCE(c.unread_customer, 0) + 1
      ELSE COALESCE(c.unread_customer, 0)
    END,
    unread_staff = CASE
      WHEN NEW.sender_id IS NOT DISTINCT FROM c.customer_id
        THEN COALESCE(c.unread_staff, 0) + 1
      ELSE COALESCE(c.unread_staff, 0)
    END,
    unread_count = CASE
      WHEN NEW.sender_id IS DISTINCT FROM c.customer_id
        THEN COALESCE(c.unread_customer, 0) + 1
      ELSE COALESCE(c.unread_customer, 0)
    END
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;
