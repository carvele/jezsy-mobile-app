-- Rollback: put the slot rules back inside the trigger and drop the shared
-- function. Only safe once nothing else calls assert_bookable_slot -- the
-- reschedule RPCs do, so roll those back first.
DROP FUNCTION IF EXISTS public.assert_bookable_slot(date, timestamptz, uuid, boolean);
