DROP TRIGGER IF EXISTS direct_messages_inserted ON public.direct_messages;
DROP FUNCTION IF EXISTS public.set_direct_chats_updated_at();

DROP TABLE IF EXISTS public.direct_messages;
DROP TABLE IF EXISTS public.direct_chat_participants;
DROP TABLE IF EXISTS public.direct_chats;
