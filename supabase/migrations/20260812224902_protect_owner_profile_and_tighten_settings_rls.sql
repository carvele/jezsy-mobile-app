-- StaffManagement.jsx's "Owner cannot be removed" guarantee is enforced
-- client-side only (a plain profiles.update({deleted:true}), no RPC). The
-- existing check_profile_updates trigger blocks the Owner from touching
-- their OWN row and blocks assigning role='owner', but never checked
-- whether the row being modified already IS the Owner -- so any Owner
-- could archive/terminate/block the Owner account directly from the
-- browser console or any script, bypassing the UI's own protection.
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
    NEW.is_blocked IS DISTINCT FROM OLD.is_blocked OR
    NEW.deleted IS DISTINCT FROM OLD.deleted
  ) THEN
    IF auth.uid() IS NOT NULL THEN
      IF auth.uid() = OLD.id THEN
        RAISE EXCEPTION 'You cannot modify your own role, employment status, block status, or deletion status.';
      END IF;

      SELECT role INTO performer_role
      FROM public.profiles
      WHERE id = auth.uid() AND deleted = false;

      IF performer_role IS NULL OR performer_role NOT IN ('owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, block status, or deletion status.';
      END IF;

      IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'The Owner role cannot be assigned through the application.';
      END IF;

      IF OLD.role = 'owner' THEN
        RAISE EXCEPTION 'The Owner account cannot be modified.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- settings (GCash display fields, reservation rules, AR toggles) was
-- writable by plain 'staff' accounts (is_staff_or_admin()), broader than
-- the route guard (RequireAdmin) and broader than the equivalent policy on
-- store_hours/store_closures (is_admin_or_owner()). No current legitimate
-- code path relies on staff-tier write access here (repo-wide grep found
-- no reads of these columns from the mobile app at all yet). Tightening to
-- match the intended access tier before that wiring exists.
DROP POLICY IF EXISTS "Enable all access for owner/staff" ON public.settings;
CREATE POLICY "Enable all access for owner/staff"
  ON public.settings FOR ALL
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());
