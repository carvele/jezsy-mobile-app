-- Fix RLS slowness on profiles/user_measurements saves (and every other
-- table gated by these two helper functions).
--
-- Root cause: is_staff_or_admin() and is_device_approved() were both marked
-- VOLATILE (plpgsql's default when not declared otherwise). A VOLATILE
-- function can never be cached or hoisted by the planner, so it is
-- re-executed in full on every single row/policy check that references it --
-- unlike auth.uid() (already fixed for initplan caching in
-- 20260813075946_fix_rls_auth_uid_initplan_performance.sql). Both functions
-- only ever SELECT (never write) and depend solely on the current session's
-- auth.uid()/JWT claims, which cannot change mid-statement -- textbook
-- STABLE, just mismarked.
--
-- Concretely, on the mobile app's "Save measurements" flow alone:
--  - profiles UPDATE evaluates "Enable all access for admin/staff"
--    (is_staff_or_admin()) as one of two OR'd permissive policies.
--  - user_measurements UPSERT evaluates is_staff_or_admin() on BOTH the
--    INSERT-path and the UPDATE-path policy (ON CONFLICT DO UPDATE checks
--    both), each a fresh, uncached call.
--  - is_staff_or_admin() itself queries profiles by id/role and, for actual
--    staff/admin, calls is_device_approved(), which was doing a sequential
--    scan of public.devices (no index on session_id) on every call.
-- None of this shows up as a query-plan-level problem in isolation, but it
-- compounds into real multi-hundred-ms-to-multi-second latency under any
-- load or connection-pool contention, which is exactly what a client-side
-- request timeout ("The request took too long...") surfaces.
--
-- Also fixes one regression: `restrict_profile_insert_to_own_auth` (added
-- after the Aug 13 initplan-fix migration, so it never got the same
-- treatment) called auth.uid()/auth.jwt() unwrapped, reintroducing the
-- per-row-reevaluation cost the Aug 13 migration eliminated everywhere else.
--
-- And drops two policies on user_measurements that are byte-for-byte
-- identical in effect to the table's existing FOR ALL policy -- Postgres
-- evaluates every applicable permissive policy and ORs the results, so
-- these were pure duplicate work on every insert/select, never a distinct
-- permission.

-- ── 1. Make the helper functions cacheable within a statement ─────────────
-- Read-only, session-scoped: safe to mark STABLE. This is the primary fix --
-- it benefits every one of this function's ~50 call sites across the schema,
-- not just the two tables below.
ALTER FUNCTION public.is_staff_or_admin() STABLE;
ALTER FUNCTION public.is_device_approved() STABLE;

-- ── 2. Index the lookup is_device_approved() does on every staff/admin check
CREATE INDEX IF NOT EXISTS idx_devices_session_id_status
ON public.devices (session_id, status);

-- ── 3. Wrap is_staff_or_admin() calls as initplans on the two tables this
-- save flow touches, matching the Aug 13 auth.uid() pattern so the planner
-- evaluates it once per statement instead of once per policy check.
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.profiles;
CREATE POLICY "Enable all access for admin/staff" ON public.profiles
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select is_staff_or_admin()))
  WITH CHECK ((select is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable insert for own measurements or admin" ON public.user_measurements;
DROP POLICY IF EXISTS "Enable select for own measurements or admin" ON public.user_measurements;
DROP POLICY IF EXISTS "Enable update/delete for own measurements or admin" ON public.user_measurements;
CREATE POLICY "Enable all access for own measurements or admin" ON public.user_measurements
  AS PERMISSIVE FOR ALL TO public
  USING ((user_id = (select auth.uid())) OR (select is_staff_or_admin()))
  WITH CHECK ((user_id = (select auth.uid())) OR (select is_staff_or_admin()));

-- ── 4. Fix the unwrapped auth.uid()/auth.jwt() regression on profiles INSERT
DROP POLICY IF EXISTS "restrict_profile_insert_to_own_auth" ON public.profiles;
CREATE POLICY "restrict_profile_insert_to_own_auth" ON public.profiles
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) = id) AND (email = ((select auth.jwt()) ->> 'email'::text)));
