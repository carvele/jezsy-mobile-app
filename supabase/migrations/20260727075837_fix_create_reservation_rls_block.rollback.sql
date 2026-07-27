-- Reverts 20260727075813_fix_create_reservation_rls_block.sql
--
-- Restores SECURITY INVOKER and the anon EXECUTE grant. Note that reverting
-- re-breaks customer reservations: with SECURITY INVOKER the INSERT is again
-- refused by the admin-only reservations INSERT policy.

ALTER FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text)
  SECURITY INVOKER;
