-- Rollback: drop the reservations.status vocabulary constraint.

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check;
