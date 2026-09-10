-- Rollback for: 20260910300000_revoke_anon_execute_on_rls_helpers
-- Restores anon EXECUTE on RLS role-check helpers

GRANT EXECUTE ON FUNCTION public.is_admin_or_owner() TO anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO anon;
