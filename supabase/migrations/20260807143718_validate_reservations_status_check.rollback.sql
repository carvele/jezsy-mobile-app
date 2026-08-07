-- Rollback: return the constraint to NOT VALID.
-- Postgres cannot un-validate in place, so drop and re-add unvalidated.
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending','Request Approval','Confirmed','Approved','To Pay',
    'To Pickup','Fitting','Active','Completed','Cancelled'
  ))
  NOT VALID;
