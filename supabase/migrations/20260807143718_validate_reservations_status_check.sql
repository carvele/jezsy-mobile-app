-- Every existing row is inside the vocabulary (verified: 0 outside), so the
-- constraint can be validated rather than left governing new writes only.
-- Separate from the ADD so the two can be reasoned about independently: adding
-- is always safe, validating is only safe once the history is known clean.
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_status_check;
