-- Constrain reservations.status to the agreed vocabulary.
--
-- The column is free text with no constraint, which is how the mobile app and
-- the admin dashboard drifted into two different status lists without anything
-- failing. Nothing rejected a typo or a status only one side knew about.
--
-- The list below is the union of what both codebases write today, including
-- the legacy values ('To Pay', 'Fitting', 'Active', 'Approved',
-- 'Request Approval') that the dashboard still reconciles for historical rows.
-- Narrowing it further means migrating those rows first, which is a separate
-- decision.
--
-- NOT VALID so the constraint applies to new writes immediately without
-- scanning existing rows -- a re-apply on a table that already has drifted
-- history must not fail closed on a live shared database. Validate separately
-- once the existing rows are known clean:
--
--   ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_status_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_status_check
      CHECK (status IN (
        'Pending',
        'Request Approval',
        'Confirmed',
        'Approved',
        'To Pay',
        'To Pickup',
        'Fitting',
        'Active',
        'Completed',
        'Cancelled'
      ))
      NOT VALID;
  END IF;
END $$;

-- Surfaces any row the constraint would reject, so the drift is visible before
-- anyone runs VALIDATE.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.reservations
  WHERE status IS NOT NULL
    AND status NOT IN (
      'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
      'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
    );

  IF v_bad > 0 THEN
    RAISE NOTICE 'reservations.status: % row(s) outside the agreed vocabulary', v_bad;
  END IF;
END $$;
