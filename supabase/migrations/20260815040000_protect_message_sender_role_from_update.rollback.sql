-- Rollback for 20260815040000_protect_message_sender_role_from_update.sql.
-- Restores enforce_message_edit_scope() to the 20260722172749 version:
-- sender_role becomes editable again by the message's own sender or
-- staff/owner (the spoofing gap this migration closed). Only use this to
-- revert to that known-vulnerable state, not as a template.

CREATE OR REPLACE FUNCTION public.enforce_message_edit_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  -- Sender and staff/owner may edit any column (unchanged behavior).
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
