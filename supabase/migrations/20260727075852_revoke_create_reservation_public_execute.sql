-- Companion to 20260727075837_fix_create_reservation_rls_block.sql.
--
-- create_reservation is now SECURITY DEFINER, so its grant surface matters
-- more than it did as INVOKER. Anon calls already failed closed on the
-- auth.uid() IS NULL guard, but leaving anon EXECUTE on an RLS-bypassing
-- function is the exact shape flagged as H-1 on create_reservations_from_cart.
--
-- REVOKE FROM anon alone is a no-op here: EXECUTE is granted to PUBLIC by
-- default and anon inherits it. Confirmed empirically -- applying only the
-- anon revoke left has_function_privilege('anon', ...) = true. Revoke PUBLIC
-- first, then re-grant the roles that should keep it.

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO authenticated;
