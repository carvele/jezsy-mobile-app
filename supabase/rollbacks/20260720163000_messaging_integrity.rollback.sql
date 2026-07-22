ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_customer_id_key;
DROP INDEX IF EXISTS public.idx_messages_sender_id;
DROP INDEX IF EXISTS public.idx_messages_conversation_id;
ALTER TABLE public.messages ALTER COLUMN conversation_id DROP NOT NULL;
