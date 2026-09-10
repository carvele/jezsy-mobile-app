-- 'Pending' and 'Request Approval' are dead: no live code path in either
-- jezsy-mobile-app or admin-dashboard writes them anymore.
--
-- 'Pending' was only ever written by create_admin_reservation, which was
-- called from nowhere and dropped in 20260911100000. 'Request Approval'
-- never had a dedicated writer at all -- migration history shows it was
-- already unreachable as far back as 20260813035443, which recorded a live
-- data audit finding zero rows with that value at the time.
--
-- Confirmed zero live rows with either value before applying this.

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status = ANY (ARRAY[
    'Confirmed', 'Approved', 'To Pay', 'Preparing', 'Ready',
    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
  ]))
  NOT VALID;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_status_check;
