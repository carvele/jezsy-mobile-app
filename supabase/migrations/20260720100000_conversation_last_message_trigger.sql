-- Migration: Denormalize conversation "last message" via a DB trigger
--
-- docs/ARCHITECTURE.md Part 4, finding 4: MessagesContext.sendMessage inserted
-- a message and then, in a *separate* non-atomic client call, updated the
-- parent conversation's last_message / last_message_time. A failure between
-- the two left the conversation list showing a stale preview, and it cost an
-- extra round-trip on every send.
--
-- This trigger makes the denormalization atomic with the insert and authoritative
-- regardless of which client (customer app or staff/admin app) sent the message.
-- It only touches last_message / last_message_time -- both are pure functions of
-- the row just inserted, so the write is idempotent and safe even if a client
-- also happens to set them.
--
-- unread_count is intentionally NOT modified here. Its semantics are shared
-- with the separate staff/admin app (a single counter for a two-party
-- conversation), and no existing trigger or function in this database touches
-- it, so changing it server-side could double-count against whatever the admin
-- app currently does. Fixing the customer-side unread badge (which currently
-- never increments) needs coordination with that app and is left as a
-- follow-up.

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

DROP TRIGGER IF EXISTS trg_sync_conversation_on_message ON public.messages;
CREATE TRIGGER trg_sync_conversation_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_conversation_on_message();
