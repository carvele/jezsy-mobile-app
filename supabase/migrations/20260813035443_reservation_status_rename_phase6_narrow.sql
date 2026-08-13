-- Phase 6 (final) of the reservation-status-vocabulary rename.
-- Narrows reservations_status_check to the final 6-value canonical
-- vocabulary, dropping every pre-rename legacy value the phase 1 migration
-- widened to accept.
--
-- Safe to apply because, at the time of this migration:
--   - Phase 1 (DB widen) is live.
--   - Phase 2 (mobile app: Preparing bucket, reservationStatus.ts, stale
--     status-badge fix, payments-create edge function) is merged, built,
--     and installed on the test device.
--   - Phase 3/3b (admin-dashboard: Preparing stage, actual stored-value
--     rename Confirmed->To Pay and To Pickup->Ready) is merged and
--     auto-deployed live.
--   - Live `reservations.status` distribution was checked immediately
--     before this migration: only 'Pending', 'Completed' and 'Cancelled'
--     rows exist. No legacy value ('Confirmed', 'Approved', 'To Pickup',
--     'Fitting', 'Active', 'Request Approval') is present on any row, so
--     nothing needed backfilling.
--
-- Final vocabulary: Pending, To Pay, Preparing, Ready, Completed, Cancelled.

ALTER TABLE public.reservations DROP CONSTRAINT reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status = ANY (ARRAY['Pending', 'To Pay', 'Preparing', 'Ready', 'Completed', 'Cancelled']));
