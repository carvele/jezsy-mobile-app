-- Reschedule becomes a request the shop approves, not a change the customer
-- makes unilaterally.
--
-- reschedule_reservation wrote the new date straight onto the booking: no
-- approval, no staff notification. Staff would arrive to a day that had moved
-- under them. The proposal now sits alongside the live booking until someone
-- accepts it.
--
-- Columns rather than a table: a reservation has at most one outstanding
-- request, and a table would need its own RLS, its own indexes and a join on
-- every read for no gain.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reschedule_requested_date date,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at_time timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at timestamptz;

-- A pending request is exactly "requested_at is set". The other two are
-- meaningless without it, so they travel together or not at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_reschedule_request_complete_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_reschedule_request_complete_check
      CHECK (
        (reschedule_requested_at IS NULL
          AND reschedule_requested_date IS NULL
          AND reschedule_requested_at_time IS NULL)
        OR
        (reschedule_requested_at IS NOT NULL
          AND reschedule_requested_date IS NOT NULL
          AND reschedule_requested_at_time IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.reservations.reschedule_requested_at IS
  'When the customer asked to move the appointment. NULL means no request is outstanding; this column alone decides whether one is pending.';
COMMENT ON COLUMN public.reservations.reschedule_requested_date IS
  'Proposed date. Never the live booking -- that stays in date until staff approve.';
COMMENT ON COLUMN public.reservations.reschedule_requested_at_time IS
  'Proposed appointment timestamp. Never the live booking -- that stays in appointment_time until staff approve.';
