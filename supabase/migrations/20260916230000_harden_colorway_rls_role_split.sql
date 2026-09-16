-- Migration: Harden colorway RLS by splitting into role-scoped policies
--
-- Problem: The combined SELECT policy used a boolean expression
--   (auth.role() = 'authenticated' AND public.is_staff_or_admin())
-- to gate the privileged function. PostgreSQL does not guarantee boolean
-- evaluation order, so an anon caller could still invoke is_staff_or_admin()
-- and receive permission denied.
--
-- Fix: Replace combined policies with two separate, role-scoped policies
-- per table, so is_staff_or_admin() is never present in the anon execution
-- path at all -- not as a call, not as a dead branch.
--
--   Policy 1 (TO anon, authenticated): public products only, no helper call
--   Policy 2 (TO authenticated): staff/admin extended read via is_staff_or_admin()
--
-- The existing ALL-operation staff/admin management policies are unchanged.

-- ============================================================
-- product_colorways
-- ============================================================

-- Drop combined read policy (previous fix attempt)
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorways for active products" ON public.product_colorways;

-- Policy 1: public customer read -- never calls is_staff_or_admin()
CREATE POLICY "Public read active colorways for public products"
  ON public.product_colorways
  FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_colorways.product_id
        AND p.deleted = false
        AND p.visibility = 'public'
    )
  );

-- Policy 2: staff/admin extended read (non-public products visible)
CREATE POLICY "Staff read all active colorways"
  ON public.product_colorways
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- ============================================================
-- product_colorway_images
-- ============================================================

-- Drop combined read policy (previous fix attempt)
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorway images" ON public.product_colorway_images;

-- Policy 1: public customer read -- never calls is_staff_or_admin()
CREATE POLICY "Public read colorway images for public products"
  ON public.product_colorway_images
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.product_colorways cw
      JOIN public.products p ON p.id = cw.product_id
      WHERE cw.id = product_colorway_images.colorway_id
        AND cw.is_active = true
        AND p.deleted = false
        AND p.visibility = 'public'
    )
  );

-- Policy 2: staff/admin extended read
CREATE POLICY "Staff read all colorway images"
  ON public.product_colorway_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.product_colorways cw
      WHERE cw.id = product_colorway_images.colorway_id
        AND public.is_staff_or_admin()
    )
  );
