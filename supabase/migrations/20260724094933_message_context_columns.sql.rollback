-- Rollback: remove message context columns
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_context_type_check;
ALTER TABLE public.messages
  DROP COLUMN IF EXISTS context_type,
  DROP COLUMN IF EXISTS context_ref,
  DROP COLUMN IF EXISTS context_label;
