-- Fix: public.store_hours and public.store_closures do not exist in the
-- live database, even though supabase_migrations.schema_migrations shows
-- 20260629085600_reservation_schedule (which creates them) as applied, and
-- three later migrations (audit_hardening, audit_hardening_resume,
-- create_reservation_rpc) all assume they exist. Root cause of the gap
-- couldn't be established (no local migration ever drops them; most likely
-- a manual/out-of-band drop against the shared live project -- see
-- docs/DB_IMPLEMENTATION_PLAN.md for the shared-migration-ledger context).
--
-- Impact confirmed live: validate_reservation_time() (BEFORE INSERT/UPDATE
-- trigger on reservations) raises "relation does not exist" on every
-- attempt, and TimeSlotPicker.tsx's catch block swallows that into a
-- generic "Error / Failed to load schedule" slot -- no customer could
-- create a reservation.
--
-- Recreates both tables with the exact schema validate_reservation_time()
-- and TimeSlotPicker.tsx expect, reseeds the original default hours
-- (Mon-Sat 10:00-20:00, Sunday closed), restores the CHECK constraints
-- added later in audit_hardening_resume, and adds RLS (never present
-- originally, but every other table in this project has it -- leaving
-- these two as the sole unprotected tables would be inconsistent with the
-- project's established security posture).

CREATE TABLE IF NOT EXISTS public.store_hours (
    day_of_week integer PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
    open_time time NOT NULL,
    close_time time NOT NULL,
    is_closed boolean DEFAULT false
);

INSERT INTO public.store_hours (day_of_week, open_time, close_time, is_closed) VALUES
(0, '10:00:00', '20:00:00', true),  -- Sunday
(1, '10:00:00', '20:00:00', false), -- Monday
(2, '10:00:00', '20:00:00', false), -- Tuesday
(3, '10:00:00', '20:00:00', false), -- Wednesday
(4, '10:00:00', '20:00:00', false), -- Thursday
(5, '10:00:00', '20:00:00', false), -- Friday
(6, '10:00:00', '20:00:00', false)  -- Saturday
ON CONFLICT (day_of_week) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.store_closures (
    closure_date date PRIMARY KEY,
    reason text,
    is_fully_closed boolean DEFAULT true,
    custom_open_time time,
    custom_close_time time
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_hours_valid_times'
      AND conrelid = 'public.store_hours'::regclass
  ) THEN
    ALTER TABLE public.store_hours
    ADD CONSTRAINT store_hours_valid_times
    CHECK (is_closed OR open_time < close_time);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_closures_valid_custom_hours'
      AND conrelid = 'public.store_closures'::regclass
  ) THEN
    ALTER TABLE public.store_closures
    ADD CONSTRAINT store_closures_valid_custom_hours
    CHECK (
      is_fully_closed
      OR custom_open_time IS NULL
      OR custom_close_time IS NULL
      OR custom_open_time < custom_close_time
    );
  END IF;
END $$;

ALTER TABLE public.store_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view store hours" ON public.store_hours;
CREATE POLICY "Authenticated users can view store hours"
  ON public.store_hours FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff manage store hours" ON public.store_hours;
CREATE POLICY "Staff manage store hours"
  ON public.store_hours FOR ALL
  TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

DROP POLICY IF EXISTS "Authenticated users can view store closures" ON public.store_closures;
CREATE POLICY "Authenticated users can view store closures"
  ON public.store_closures FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff manage store closures" ON public.store_closures;
CREATE POLICY "Staff manage store closures"
  ON public.store_closures FOR ALL
  TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());
