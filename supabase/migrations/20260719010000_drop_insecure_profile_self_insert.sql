-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- Exists live (ledger version 20260719010000, name
-- drop_insecure_profile_self_insert) with no file in this repo and no
-- retrievable original SQL. Given the name and its position immediately
-- after add_profile_self_insert_policy, this almost certainly dropped an
-- earlier, more permissive self-insert policy on profiles (e.g. one with no
-- WITH CHECK, or one granted to anon) that predates both the current
-- "Enable insert for authenticated users only" policy and this repo's
-- migration history. Its exact original name/definition could not be
-- recovered -- it is absent from the live database today, which is the
-- effect being preserved here.
--
-- This file is a placeholder documenting that a self-insert policy tighter
-- than "insert for any authenticated user with no id check" was intended,
-- and is idempotent/inert (DROP POLICY IF EXISTS) so it is a safe no-op.
-- No corrective action is taken here.

DROP POLICY IF EXISTS "Enable insert for own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for users based on id" ON public.profiles;
