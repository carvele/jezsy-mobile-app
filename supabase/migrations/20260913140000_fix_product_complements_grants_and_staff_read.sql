-- Migration: 20260913140000_fix_product_complements_grants_and_staff_read.sql
-- Description:
-- 1. Grant SELECT on `origin` and `is_active` on public.product_complements
--    to anon and authenticated roles. Resolves the HTTP 403 error on the Admin
--    Dashboard's Complete the Look panel where listComplements selects:
--    'id, product_id, complementary_product_id, sort_order, origin, is_active'.
-- 2. Add RLS SELECT policy for authenticated staff with public.can_manage_inventory()
--    so staff can view both active and inactive curated complement links.

-- Grant read privileges for relationship metadata columns
GRANT SELECT (
  origin,
  is_active
) ON public.product_complements TO anon, authenticated;

-- Allow staff with inventory management capability to view all complements (including inactive)
DROP POLICY IF EXISTS "Staff read all complements" ON public.product_complements;
CREATE POLICY "Staff read all complements"
  ON public.product_complements FOR SELECT
  TO authenticated
  USING (public.can_manage_inventory());
