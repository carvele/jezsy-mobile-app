-- is_staff_or_admin() and is_admin_or_owner() are referenced starting with
-- the very next migration (20260719120000_rls_tighten_and_consolidate.sql)
-- and repeatedly thereafter, but neither was ever created by a migration --
-- they were applied ad hoc directly against the live DB, then later
-- hardened in place by 20260809180000_harden_role_helpers.sql (CREATE OR
-- REPLACE). Replaying this ledger from scratch against an empty database
-- would fail at 20260719120000 with "function is_staff_or_admin() does not
-- exist". This migration creates the baseline (already-hardened) version at
-- the point in the ledger where it's first needed; is_blocked and
-- employment_status already exist on profiles by this point (see
-- 20260712000001_add_rls_policies_and_triggers.sql). 20260809180000 later
-- re-applies the identical body via CREATE OR REPLACE, which is a no-op.

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  user_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted = false
    AND is_blocked = false
    AND coalesce(employment_status, 'active') = 'active';

  RETURN coalesce(user_role IN ('admin', 'staff', 'owner'), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  user_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted = false
    AND is_blocked = false
    AND coalesce(employment_status, 'active') = 'active';

  RETURN coalesce(user_role IN ('admin', 'owner'), false);
END;
$function$;
