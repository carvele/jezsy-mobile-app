-- Rollback for 20260904230000_restore_conversations_unread_count_and_sync_trigger.sql
ALTER TABLE public.conversations DROP COLUMN IF EXISTS unread_count;

CREATE OR REPLACE FUNCTION public.force_conversation_unread_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.unread_customer := 0;
  RETURN NEW;
END;
$$;
