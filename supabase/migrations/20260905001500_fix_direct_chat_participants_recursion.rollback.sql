-- Rollback for 20260905001500_fix_direct_chat_participants_recursion.sql
DROP POLICY IF EXISTS "Users can view participants of their chats" ON public.direct_chat_participants;
DROP POLICY IF EXISTS "Users can view chats they are in" ON public.direct_chats;
DROP POLICY IF EXISTS "Users can read their direct messages" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can send messages to connections" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can mark messages as read" ON public.direct_messages;

DROP FUNCTION IF EXISTS public.is_chat_participant(uuid, uuid);
