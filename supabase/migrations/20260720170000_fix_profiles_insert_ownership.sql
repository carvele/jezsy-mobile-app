-- Migration: Require id = auth.uid() on profiles INSERT
--
-- "Enable insert for authenticated users only" only checked
-- auth.role() = 'authenticated', with no ownership check. Any authenticated
-- user could INSERT a profiles row for an arbitrary id -- e.g. pre-creating
-- a hostile profile row for another real auth.users id before that user's
-- first login triggers handle_new_user, or squatting on an id entirely.
--
-- Discovered 2026-07-20 while reconstructing migration history for
-- DB_IMPLEMENTATION_PLAN.md Batch 2; fixed here as its own migration since
-- it's a live security gap, not bookkeeping.
--
-- Verified safe before writing: neither app's code performs a raw INSERT
-- into profiles -- both only call .upsert() with id set to the caller's own
-- auth id (AuthContext.tsx, profile-setup.tsx), and new-user profile rows
-- are created by the handle_new_user SECURITY DEFINER trigger, which
-- bypasses RLS entirely and is unaffected by this policy change.

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;

CREATE POLICY "Enable insert for authenticated users only"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
