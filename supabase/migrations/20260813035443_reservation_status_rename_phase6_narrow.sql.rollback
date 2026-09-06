-- Rollback for 20260813035443_reservation_status_rename_phase6_narrow.sql
-- Re-widens the constraint to accept every pre-rename legacy value again,
-- alongside the final vocabulary. Does not revert any application code or
-- restore old stored values -- it only re-opens the CHECK constraint in
-- case a rollback of the app deploys needs the DB to accept old writes
-- again.

ALTER TABLE public.reservations DROP CONSTRAINT reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status = ANY (ARRAY[
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'Preparing', 'To Pickup', 'Fitting', 'Active', 'Ready',
    'Completed', 'Cancelled'
  ])) NOT VALID;
