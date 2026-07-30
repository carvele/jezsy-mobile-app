-- Message editing. Permission already exists: enforce_message_edit_scope
-- (20260722172749) lets the sender change `text` and blocks everyone else from
-- touching anything but read_at and reactions. This only adds the marker so the
-- UI can show that a message was edited.
--
-- Nullable with no default: null means never edited, which is the correct state
-- for every existing row.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMENT ON COLUMN public.messages.edited_at IS
  'Set when the sender edits the message text. Null means never edited.';
