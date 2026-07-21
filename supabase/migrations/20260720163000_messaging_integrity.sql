-- Migration: Messaging table integrity
--
-- messages.conversation_id was nullable and unindexed despite being the
-- table's primary access path; a NULL row would be unreachable garbage with
-- nothing preventing it. conversations.customer_id had no uniqueness even
-- though both apps' code assumes one conversation thread per customer
-- ("find the customer's conversation").
--
-- 0 rows in messages, 1 row in conversations at time of writing -- no
-- backfill needed.

ALTER TABLE public.messages
  ALTER COLUMN conversation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_customer_id_key UNIQUE (customer_id);
