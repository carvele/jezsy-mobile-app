-- Pins search_path on the 10 SECURITY DEFINER / trigger functions still
-- missing it (advisor lint 0011_function_search_path_mutable). Without a
-- fixed search_path, a SECURITY DEFINER function can be hijacked by an
-- attacker who creates an object in a schema that resolves earlier on the
-- caller's path -- the definer's elevated privileges then run against it.
-- No behavior change; every function keeps its existing body.

ALTER FUNCTION public.handle_new_user() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.check_email_exists(text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.is_admin_or_owner() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.check_profile_updates() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.update_staff_status(uuid, text, boolean, text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.log_staff_status_change() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.approve_device() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.update_product_rating() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.prevent_stock_movement_updates() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.create_reservations_from_cart(jsonb, text, text, text) SET search_path = 'public', 'pg_temp';
