-- The 20260904185300 split migration was meant to add unread_customer/
-- unread_staff and drop the legacy unread_count, but the drop never
-- actually happened live: a since-lost migration re-added a trigger
-- (force_conversation_unread_zero) that still writes to unread_count on
-- every insert, so dropping it outright would have broken every new
-- conversation row. This finishes that migration properly.
--
-- User-approved 2026-09-05: no code reads unread_count (confirmed via
-- repo-wide grep); admin-dashboard tracks read state via read_at instead
-- and only mentions this column in a comment as "unrelated".
--
-- Two live functions still write it: force_conversation_unread_zero
-- (insert-time reset) and sync_conversation_on_message (the real
-- message-arrival trigger -- which was also always writing unread_count
-- to the same value as unread_customer regardless of who sent the
-- message, so it was already stale/wrong, not just dead).

CREATE OR REPLACE FUNCTION public.force_conversation_unread_zero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
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
    END
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

ALTER TABLE public.conversations DROP COLUMN IF EXISTS unread_count;
