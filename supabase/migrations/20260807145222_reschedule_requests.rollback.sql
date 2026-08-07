-- Rollback: drop the reschedule request columns.
-- Destructive: any request still awaiting a decision is lost.
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_reschedule_request_complete_check;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS reschedule_requested_at,
  DROP COLUMN IF EXISTS reschedule_requested_at_time,
  DROP COLUMN IF EXISTS reschedule_requested_date;
