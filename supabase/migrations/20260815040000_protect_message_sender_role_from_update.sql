-- Closes a real, verified spoofing gap in enforce_message_edit_scope()
-- (20260722172749_scope_message_updates.sql): the sender/staff branch lets
-- the message's own sender edit *any* column on their own row, including
-- sender_role. sender_role is a trusted, server-derived classification --
-- set_message_sender_role() (BEFORE INSERT) computes it once from the
-- sender's actual profiles.role, purely so downstream code (the admin
-- dashboard's new-message alert filter in useRealtimeSync.js, message
-- bubble styling in both apps) can trust it without re-deriving the
-- sender's role on every read. It was never meant to be editable after
-- insert, by anyone, but nothing enforced that.
--
-- Confirmed live in a rolled-back transaction before writing this fix: a
-- customer could UPDATE their own message's sender_role from 'customer'
-- to 'staff' and it succeeded -- the messages UPDATE RLS policy's USING
-- clause only checks conversation ownership (not this column), and this
-- trigger's own "sender may edit any column" branch didn't carve it out
-- either. Making sender_role immutable via UPDATE, for every caller
-- (including staff/admin -- correcting a genuinely wrong classification
-- is an ops/migration task, not a runtime feature), closes it.

CREATE OR REPLACE FUNCTION public.enforce_message_edit_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  -- sender_role is set once at INSERT time and must never change after --
  -- applies to every caller, including the sender and staff/admin below.
  IF NEW.sender_role IS DISTINCT FROM OLD.sender_role THEN
    RAISE EXCEPTION 'sender_role cannot be changed after the message is sent.';
  END IF;

  -- Sender and staff/admin may edit any other column (unchanged behavior).
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
