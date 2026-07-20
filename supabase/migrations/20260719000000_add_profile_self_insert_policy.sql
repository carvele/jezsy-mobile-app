-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- This migration exists live (ledger version 20260719000000, name
-- add_profile_self_insert_policy) but was never committed to this repo.
-- No original SQL text is retrievable from Supabase's migration ledger (it
-- records version/name, not source). This file reconstructs the migration's
-- effect from the LIVE policy definition it is believed to have created,
-- confirmed still present and unchanged today:
--   "Enable insert for authenticated users only" FOR INSERT
--   WITH CHECK (auth.role() = 'authenticated')
--
-- This is a best-effort reconstruction for historical/documentation
-- completeness, not a verified copy of the original statements. It is
-- written idempotently (IF NOT EXISTS) so it is a safe no-op if ever
-- re-run; it should not be re-applied to a database where it (or its
-- current live equivalent) already exists.
--
-- NOTE: this policy's WITH CHECK does not verify id = auth.uid(), so any
-- authenticated user can currently INSERT a profiles row for an arbitrary
-- id. Flagged separately as a live finding, not fixed here -- this file's
-- only purpose is to give the live schema state a matching file in git.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.profiles'::regclass
      AND polname = 'Enable insert for authenticated users only'
  ) THEN
    CREATE POLICY "Enable insert for authenticated users only"
      ON public.profiles FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;
