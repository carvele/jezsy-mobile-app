-- Migration: Enforce uniqueness on reservations.display_id
--
-- orders.display_id already has a UNIQUE constraint; reservations.display_id
-- does not, despite being generated the same way (check-then-insert loop in
-- create_reservation). Without a DB constraint, two concurrent reservation
-- inserts can race past the "not exists" check and produce duplicate
-- customer-facing reservation numbers. Table has 0 rows; no backfill needed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_display_id_key'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_display_id_key UNIQUE (display_id);
  END IF;
END $$;
