-- Reverts 20260727080100_pin_is_staff_or_admin_search_path.sql

ALTER FUNCTION public.is_staff_or_admin() SET search_path = 'public';
