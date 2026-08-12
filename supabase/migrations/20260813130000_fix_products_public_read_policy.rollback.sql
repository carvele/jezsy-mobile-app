-- Rollback for 20260813130000_fix_products_public_read_policy.sql.
-- Restores the permissive USING (true) policy. Only use this to revert to
-- a known-insecure state, not as a template.

DROP POLICY IF EXISTS "Public can only read visible active products" ON public.products;

CREATE POLICY "Public read products" ON public.products
  FOR SELECT
  USING (true);
