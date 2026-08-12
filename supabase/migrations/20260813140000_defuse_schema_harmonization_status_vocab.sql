-- Defuses 20260809230000_schema_harmonization_pack.sql, which was never
-- applied (absent from the migration ledger and from the live schema) but
-- is a live landmine: its status vocabulary (Pending, Confirmed, Ready,
-- Active, Completed, Cancelled) is missing To Pay, To Pickup, Request
-- Approval, Approved, Fitting -- values used throughout both apps and
-- present in the live reservations_status_check constraint added by
-- 20260807143425_reservations_status_check.sql. If that migration is ever
-- applied via a routine `supabase db push`, every To Pay/To Pickup write
-- across both apps breaks simultaneously.
--
-- Rather than editing an already-merged migration file's history, this
-- re-asserts the correct state so it wins regardless of apply order: if
-- 20260809230000 runs before this one (normal timestamp order), this
-- migration corrects it immediately after. If it never runs, this is a
-- no-op confirmation of the already-correct live state.
--
-- Also adds a payment_status CHECK for the first time -- none currently
-- exists. Vocabulary derived from actual usage, not guessed: grepped every
-- payment_status/paymentStatus literal in both repos plus the live
-- distinct values in the table. Confirmed real: Pending (default),
-- Submitted, Processing, Paid. Confirmed NOT real: Unpaid, Deposit Paid,
-- Partially Paid, Refunded, Failed -- these appear only in the
-- harmonization pack's own backfill statements or in payments.status (a
-- different table/column with its own separate vocabulary), never
-- actually written to reservations.payment_status by any app code.
--
-- Also corrects both columns' DEFAULT, which is live as lowercase 'pending'
-- -- inconsistent with the TitleCase 'Pending' the CHECK constraint and
-- every app read path actually use. Any future insert relying on the
-- column default instead of setting it explicitly would otherwise violate
-- the status CHECK immediately.
--
-- Applied and verified live: both constraints correctly re-assert the
-- above vocabularies (NOT VALID, matching this table's established
-- pattern for safe re-application on a live shared database), no existing
-- rows violate either.

ALTER TABLE public.reservations ALTER COLUMN status SET DEFAULT 'Pending';
ALTER TABLE public.reservations ALTER COLUMN payment_status SET DEFAULT 'Pending';

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
  )) NOT VALID;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_payment_status_check
  CHECK (payment_status IN ('Pending', 'Submitted', 'Processing', 'Paid'))
  NOT VALID;

DO $$
DECLARE
  v_bad_status integer;
  v_bad_payment integer;
BEGIN
  SELECT count(*) INTO v_bad_status FROM public.reservations
  WHERE status IS NOT NULL AND status NOT IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
  );
  SELECT count(*) INTO v_bad_payment FROM public.reservations
  WHERE payment_status IS NOT NULL AND payment_status NOT IN ('Pending', 'Submitted', 'Processing', 'Paid');

  IF v_bad_status > 0 THEN
    RAISE NOTICE 'reservations.status: % row(s) outside the agreed vocabulary', v_bad_status;
  END IF;
  IF v_bad_payment > 0 THEN
    RAISE NOTICE 'reservations.payment_status: % row(s) outside the agreed vocabulary', v_bad_payment;
  END IF;
END $$;
