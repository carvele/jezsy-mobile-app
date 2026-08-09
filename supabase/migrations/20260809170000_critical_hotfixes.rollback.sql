-- Rollback Migration for Critical Hotfixes
REVOKE EXECUTE ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) FROM authenticated;

-- Restore check_profile_updates without deleted guard
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

      IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'The Owner role cannot be assigned through the application.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
