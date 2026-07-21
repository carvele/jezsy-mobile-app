-- Migration: Make conversations.unread_count actually increment
--
-- DB_AUDIT_2026-07-20.md flagged unread_count as written by nothing that
-- increments it, leaving the mobile Inbox badge permanently 0. This was
-- deferred pending "admin-app coordination"; that coordination question is
-- now resolved by reading both repos:
--
--   * mobile READS it (MessagesContext.tsx sums it for the badge) and RESETS
--     it to 0 in markAsRead() when the customer opens a conversation.
--   * admin NEVER reads it. It only writes: unread_count: 1 when creating a
--     conversation (customerService.js:152), and a no-op on update
--     (customerService.js:165 evaluates `supabase.rpc ? undefined : 0`, which
--     is always undefined, so the field is never sent -- its own comment says
--     "increment handled server-side ideally").
--
-- So the counter is unambiguously "messages unread BY THE CUSTOMER", and the
-- server-side increment admin's comment asks for is exactly what's missing.
--
-- Increment rule: a message increments the count only when its sender is not
-- the conversation's customer (i.e. staff replied). Customer's own messages
-- never increment their own unread badge.
--
-- DOUBLE-COUNT GUARD: admin creates a conversation with unread_count: 1 and
-- then inserts the first message, which would make this trigger bump it to 2.
-- Rather than require a lockstep change in the admin repo, a BEFORE INSERT
-- trigger forces new conversations to start at 0, making this trigger the
-- single authority over the counter. Admin's explicit 1 becomes redundant
-- instead of wrong, so both apps keep working unchanged.

CREATE OR REPLACE FUNCTION public.sync_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.conversations c
  SET
    last_message = COALESCE(
      NULLIF(NEW.text, ''),
      CASE WHEN NEW.image_url IS NOT NULL THEN 'Sent an image' ELSE c.last_message END
    ),
    last_message_time = COALESCE(NEW.created_at, now()),
    unread_count = CASE
      WHEN NEW.sender_id IS DISTINCT FROM c.customer_id
        THEN COALESCE(c.unread_count, 0) + 1
      ELSE COALESCE(c.unread_count, 0)
    END
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.force_conversation_unread_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.unread_count := 0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_conversation_unread_zero ON public.conversations;
CREATE TRIGGER trg_force_conversation_unread_zero
BEFORE INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.force_conversation_unread_zero();

REVOKE EXECUTE ON FUNCTION public.force_conversation_unread_zero() FROM PUBLIC, anon, authenticated;
