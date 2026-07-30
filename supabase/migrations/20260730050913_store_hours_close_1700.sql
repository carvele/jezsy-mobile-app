-- Boutique closes at 5pm, not 8pm.
--
-- validate_reservation_time reads operating hours from public.store_hours per
-- day_of_week rather than hardcoding them, so this is a data change and the
-- trigger needs no edit. Doing it here rather than only shrinking the picker
-- matters: the trigger is the actual gate, and the admin dashboard writes
-- through the same one.
--
-- Idempotent and narrowing-only: a day already closing at or before 17:00 is
-- left alone, so re-applying cannot widen hours back out.

UPDATE public.store_hours
SET close_time = '17:00:00'
WHERE close_time > '17:00:00';

-- Same ceiling for any one-off custom hours on a closure date, or a closure
-- with a later custom_close_time would quietly reopen the evening.
UPDATE public.store_closures
SET custom_close_time = '17:00:00'
WHERE custom_close_time > '17:00:00';
