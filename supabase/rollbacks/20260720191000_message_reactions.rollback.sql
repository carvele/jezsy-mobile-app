DROP FUNCTION IF EXISTS public.merge_message_reaction(uuid, text, text);
ALTER TABLE public.messages DROP COLUMN IF EXISTS reactions;
