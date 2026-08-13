-- New functions default to PUBLIC EXECUTE (includes anon). Not a real
-- exposure here -- the function's own is_staff_or_admin() guard and
-- inventory's RLS both already block non-staff regardless -- but tightened
-- to least privilege anyway, matching this repo's convention.
REVOKE EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, integer, integer, integer) TO authenticated;
