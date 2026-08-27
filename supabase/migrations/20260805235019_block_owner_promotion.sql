-- check_profile_updates() blocked self-modification and blocked staff from
-- touching role/employment_status/is_blocked, but never restricted WHICH
-- role could be assigned. Verified live: an owner session can UPDATE any
-- other profile's role to 'owner' via a direct API call, even though the
-- dashboard UI (StaffManagement.jsx toggleRole) treats owner as permanent
-- and never assigns it -- "The Owner role cannot be downgraded. It is
-- permanent" is a client-side message with no database backing it.
--
-- Mirrors that same permanence in the other direction: a role can become
-- 'owner' only if it already was one (a no-op), or if the caller is
-- system/superuser (auth.uid() IS NULL, e.g. seeding an owner directly).
-- Minting a new owner therefore requires direct DB access, not the app.

CREATE OR REPLACE FUNCTION public.check_profile_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  performer_role text;
BEGIN
  IF (
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.employment_status IS DISTINCT FROM OLD.employment_status OR
    NEW.is_blocked IS DISTINCT FROM OLD.is_blocked
  ) THEN
    IF auth.uid() IS NOT NULL THEN
      IF auth.uid() = OLD.id THEN
        RAISE EXCEPTION 'You cannot modify your own role, employment status, or block status.';
      END IF;

      SELECT role INTO performer_role
      FROM public.profiles
      WHERE id = auth.uid() AND deleted = false;

      IF performer_role IS NULL OR performer_role NOT IN ('owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, or block status.';
      END IF;

      IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'The Owner role cannot be assigned through the application.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- devices/store_hours/store_closures granted ALL to is_staff_or_admin(),
-- so plain staff could write to them via a direct API call even though the
-- dashboard's RequireAdmin route guard means staff never reach these pages
-- through the UI. Tightened to match: staff keep read access where they
-- had it, writes become owner-or-owner only.

DROP POLICY IF EXISTS "Enable all access for owner/staff" ON public.devices;
DROP POLICY IF EXISTS "Staff can view devices" ON public.devices;
CREATE POLICY "Staff can view devices"
ON public.devices FOR SELECT
USING (public.is_staff_or_admin());
DROP POLICY IF EXISTS "Owner or owner can manage devices" ON public.devices;
CREATE POLICY "Owner or owner can manage devices"
ON public.devices FOR ALL
USING (public.is_admin_or_owner())
WITH CHECK (public.is_admin_or_owner());

DROP POLICY IF EXISTS "Staff manage store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Owner or owner can manage store hours" ON public.store_hours;
CREATE POLICY "Owner or owner can manage store hours"
ON public.store_hours FOR ALL
USING (public.is_admin_or_owner())
WITH CHECK (public.is_admin_or_owner());

DROP POLICY IF EXISTS "Staff manage store closures" ON public.store_closures;
DROP POLICY IF EXISTS "Owner or owner can manage store closures" ON public.store_closures;
CREATE POLICY "Owner or owner can manage store closures"
ON public.store_closures FOR ALL
USING (public.is_admin_or_owner())
WITH CHECK (public.is_admin_or_owner());
