-- Rollback for 20260813140000_defuse_schema_harmonization_status_vocab.sql.
-- Drops the new payment_status_check constraint (none existed before this
-- migration) and reverts both column defaults to the prior lowercase
-- 'pending'. status_check is re-asserted identically since its content was
-- unchanged by the migration being rolled back.

ALTER TABLE public.reservations ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.reservations ALTER COLUMN payment_status SET DEFAULT 'pending';

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
  )) NOT VALID;
