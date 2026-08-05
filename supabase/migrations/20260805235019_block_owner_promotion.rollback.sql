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

      IF performer_role IS NULL OR performer_role NOT IN ('admin', 'owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, or block status.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Staff can view devices" ON public.devices;
DROP POLICY IF EXISTS "Admin or owner can manage devices" ON public.devices;
CREATE POLICY "Enable all access for admin/staff"
ON public.devices FOR ALL
USING (public.is_staff_or_admin())
WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS "Admin or owner can manage store hours" ON public.store_hours;
CREATE POLICY "Staff manage store hours"
ON public.store_hours FOR ALL
USING (public.is_staff_or_admin())
WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS "Admin or owner can manage store closures" ON public.store_closures;
CREATE POLICY "Staff manage store closures"
ON public.store_closures FOR ALL
USING (public.is_staff_or_admin())
WITH CHECK (public.is_staff_or_admin());
