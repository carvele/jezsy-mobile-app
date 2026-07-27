-- Migration: message context columns
--
-- Lets a message carry lightweight context about what it is regarding (a
-- product, reservation, or order) so staff see what an inquiry is about
-- without splitting the one-conversation-per-customer thread model. All
-- nullable and additive; existing messages and the getOrCreateConversation
-- .single() assumption are unaffected.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS context_type text,
  ADD COLUMN IF NOT EXISTS context_ref uuid,
  ADD COLUMN IF NOT EXISTS context_label text;

-- Restrict context_type to the surfaces that set it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_context_type_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_context_type_check
      CHECK (context_type IS NULL OR context_type IN ('product', 'reservation', 'order'));
  END IF;
END $$;
