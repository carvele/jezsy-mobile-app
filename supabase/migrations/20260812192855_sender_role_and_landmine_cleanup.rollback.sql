DROP TRIGGER IF EXISTS trg_set_message_sender_role ON public.messages;
DROP FUNCTION IF EXISTS public.set_message_sender_role();
ALTER TABLE public.messages DROP COLUMN IF EXISTS sender_role;

DROP POLICY IF EXISTS "Enable delete for admin" ON public.conversations;

-- Not restored: the broken create_reservation(uuid,text,text,date,
-- timestamptz,text,text,integer) overload this migration dropped. It was
-- already non-functional (referenced nonexistent columns/table) and inert
-- (EXECUTE revoked from anon/authenticated), so there is nothing safe to
-- restore it to.
