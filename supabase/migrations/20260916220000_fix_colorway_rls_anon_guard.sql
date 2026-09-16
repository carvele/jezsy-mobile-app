-- Migration: Fix colorway RLS anon guard
-- Problem: The SELECT policies on product_colorways and product_colorway_images
-- call public.is_staff_or_admin() unconditionally inside an OR clause. That
-- function has EXECUTE revoked from anon, so any anonymous catalog query
-- returns "permission denied for function is_staff_or_admin" instead of
-- the public product's colorway data.
--
-- Fix: Guard the is_staff_or_admin() call with auth.role() = 'authenticated'
-- so PostgreSQL short-circuits the OR branch for anon callers and never
-- evaluates the privileged function.

-- product_colorways: anon/authenticated public read
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorways for active products" ON public.product_colorways;
CREATE POLICY "Allow anon and authenticated to view colorways for active products"
  ON public.product_colorways
  FOR SELECT
  TO public
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_colorways.product_id
        AND p.deleted = false
        AND (
          p.visibility = 'public'
          OR (auth.role() = 'authenticated' AND public.is_staff_or_admin())
        )
    )
  );

-- product_colorway_images: anon/authenticated public read
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorway images" ON public.product_colorway_images;
CREATE POLICY "Allow anon and authenticated to view colorway images"
  ON public.product_colorway_images
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.product_colorways cw
      JOIN public.products p ON p.id = cw.product_id
      WHERE cw.id = product_colorway_images.colorway_id
        AND cw.is_active = true
        AND p.deleted = false
        AND (
          p.visibility = 'public'
          OR (auth.role() = 'authenticated' AND public.is_staff_or_admin())
        )
    )
  );
