-- Finding N-5. is_staff_or_admin() is pinned to search_path=public but omits
-- pg_temp, unlike every other SECURITY DEFINER function in this schema. A
-- temp-schema object can still shadow an unqualified reference ahead of
-- public, and this function gates authorization for most staff RLS branches.

ALTER FUNCTION public.is_staff_or_admin() SET search_path = 'public', 'pg_temp';
