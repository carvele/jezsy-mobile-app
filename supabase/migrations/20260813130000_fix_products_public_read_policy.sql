-- Fixes a live, currently-exploitable gap: the actual deployed SELECT policy
-- on public.products is "Public read products" USING (true) -- anyone,
-- unauthenticated, can read every product row regardless of deleted/
-- visibility status. Verified: 19 of 40 live products are deleted=true and
-- were all fully readable.
--
-- admin-dashboard/supabase/migrations/20260810000003_enforce_products_visibility_rls.sql
-- was meant to fix this but was never applied, and would not have worked
-- even if it had been: it drops two policy names that do not match the
-- actual live one ("Public can only read visible active products",
-- "Allow public read access for active products"), never touching
-- "Public read products". Both policies would have coexisted, and since
-- RLS policies are OR'd together, the permissive USING (true) one would
-- still have won.
--
-- Uses is_staff_or_admin() for the staff-bypass clause rather than the
-- raw inline role check that migration used, so staff/admin/owner get
-- full visibility without missing the is_blocked/employment_status guards
-- is_staff_or_admin() already enforces.
--
-- Applied and verified live: anon now sees 21 products (all visible,
-- non-deleted), 0 deleted rows visible (was 19); authenticated staff still
-- see all 40.

DROP POLICY IF EXISTS "Public read products" ON public.products;
DROP POLICY IF EXISTS "Allow public read access for active products" ON public.products;
DROP POLICY IF EXISTS "Public can only read visible active products" ON public.products;

CREATE POLICY "Public can only read visible active products" ON public.products
  FOR SELECT
  USING (
    (deleted = false AND visibility = 'public')
    OR public.is_staff_or_admin()
  );
