-- Migration: Critical Security & Integrity Hotfixes
-- 1. Grant execute on assert_bookable_slot to authenticated users (required by INVOKER trigger validate_reservation_time)
GRANT EXECUTE ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) TO authenticated;

-- 2. Restore deleted column guard in check_profile_updates()
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

      IF performer_role IS NULL OR performer_role NOT IN ('admin', 'owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, block status, or deletion status.';
      END IF;

      IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'The Owner role cannot be assigned through the application.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Ensure update_product_rating() is SECURITY DEFINER with search_path set
ALTER FUNCTION public.update_product_rating() SECURITY DEFINER SET search_path TO 'public', 'pg_temp';
GRANT EXECUTE ON FUNCTION public.update_product_rating() TO authenticated;
