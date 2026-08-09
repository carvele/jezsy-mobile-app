-- Migration: Harden is_staff_or_admin and is_admin_or_owner to check is_blocked and employment_status
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
