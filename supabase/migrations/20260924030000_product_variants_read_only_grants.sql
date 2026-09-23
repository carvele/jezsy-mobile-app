-- product_variants is intentionally SECURITY DEFINER: storefront customers read stock
-- through it while inventory itself is staff-only under RLS. Keep that, but remove the
-- write-class privileges anon/authenticated inherited so the definer view is read-only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.product_variants FROM anon, authenticated;
GRANT SELECT ON public.product_variants TO anon, authenticated;
