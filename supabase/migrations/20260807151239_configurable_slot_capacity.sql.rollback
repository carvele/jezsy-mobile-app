-- Rollback: return to a hardcoded cap of three and drop the columns.
-- assert_bookable_slot must be restored from 20260807145048 first, since this
-- version reads columns that are about to disappear.
ALTER TABLE public.store_hours
  DROP CONSTRAINT IF EXISTS store_hours_max_daily_bookings_check,
  DROP CONSTRAINT IF EXISTS store_hours_slot_capacity_check;

ALTER TABLE public.store_hours
  DROP COLUMN IF EXISTS max_daily_bookings,
  DROP COLUMN IF EXISTS slot_capacity;
