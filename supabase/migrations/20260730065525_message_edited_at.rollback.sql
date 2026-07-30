-- Reverts 20260730065525_message_edited_at.sql
--
-- Drops the marker only. Edited message text stays edited -- the original was
-- never retained, so this cannot restore it. Nothing else depends on the column.

ALTER TABLE public.messages DROP COLUMN IF EXISTS edited_at;
