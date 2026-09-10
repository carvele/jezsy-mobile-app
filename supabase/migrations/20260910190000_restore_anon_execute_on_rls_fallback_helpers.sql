-- Fixes a live regression from 20260910180000_harden_anon_security_definer_functions.sql
-- (PR #228). That migration revoked anon's EXECUTE on is_staff_or_admin()
-- and is_admin_or_owner() as part of a broad "17 anonymous SECURITY DEFINER
-- functions" hardening sweep -- correct for most of those 17, but these two
-- are also referenced as an OR-fallback branch inside RLS policies on
-- tables anon genuinely reads (products, reservations, wishlists,
-- store_hours, store_closures, and others). Both functions already return
-- false immediately when auth.uid() IS NULL, so they're safe for anon to
-- call -- but Postgres must still be able to call them at all to reach that
-- "false", or the whole containing policy expression throws a permission
-- error instead of just filtering the row out.
--
-- Confirmed live before this fix: `SET LOCAL role anon; SELECT count(*)
-- FROM public.products;` (and reservations, wishlists, store_hours,
-- store_closures) all threw `permission denied for function
-- is_staff_or_admin` / `is_admin_or_owner` -- guest browsing was broken
-- for the entire app.
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner() TO anon;
