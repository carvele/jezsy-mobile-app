ALTER TABLE public.messages
  ALTER COLUMN conversation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_customer_id_key UNIQUE (customer_id);
