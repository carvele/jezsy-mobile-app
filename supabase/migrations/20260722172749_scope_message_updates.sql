-- Closes a gap in the "Users can update their messages or mark as read"
-- UPDATE policy on public.messages: it checks conversation membership but
-- never sender ownership, so a customer or staff member could edit the
-- *text* of a message they did not send, not just mark it read or react
-- to it. RLS row-level eligibility (USING) is left as-is -- that part was
-- correct -- this adds the missing column-level restriction via trigger,
-- since RLS policies can't scope individual columns on their own.
--
-- merge_message_reaction() (20260720191000_message_reactions.sql) already
-- deliberately defers to this table's UPDATE policy instead of validating
-- its own p_user_id parameter, so this trigger is what actually protects
-- it going forward.

CREATE OR REPLACE FUNCTION public.enforce_message_edit_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  -- Sender and staff/admin may edit any column (unchanged behavior).
  IF auth.uid() = OLD.sender_id OR is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  -- Any other conversation participant is only marking as read or reacting.
  IF NEW.text IS DISTINCT FROM OLD.text
     OR NEW.image_url IS DISTINCT FROM OLD.image_url
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.sender_name IS DISTINCT FROM OLD.sender_name
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'You can only mark this message as read or react to it.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_message_edit_scope ON public.messages;
CREATE TRIGGER trg_enforce_message_edit_scope
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_edit_scope();

-- Re-assert: this grant was already revoked by 20260720191000_message_reactions.sql
-- but had drifted back open on the live DB (confirmed via has_function_privilege
-- during this migration's own verification pass).
REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) FROM anon;
