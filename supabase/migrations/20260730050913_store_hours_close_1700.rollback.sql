-- Reverts 20260730050913_store_hours_close_1700.sql
--
-- Restores the 20:00 close that was in place before. Not a true inverse: any
-- day that already closed earlier than 20:00 for its own reasons is widened to
-- 20:00 by this, because the forward migration did not record what it
-- overwrote. Check store_hours before running it.

UPDATE public.store_hours
SET close_time = '20:00:00'
WHERE close_time = '17:00:00';

UPDATE public.store_closures
SET custom_close_time = '20:00:00'
WHERE custom_close_time = '17:00:00';
