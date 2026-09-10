-- Migration: 20260910220000_remediate_mpp_batch_f1.sql
-- Description: Remediate multiple_permissive_policies on Batch F1 tables (10 tables, 42 findings resolved)
-- Replaces multi-action FOR ALL overlaps with discrete write policies (INSERT, UPDATE, DELETE)
-- scoped TO authenticated, and unifies/role-separates SELECT policies.

-- ==========================================
-- 1. wishlists (18 findings -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Users manage their own wishlist" ON public.wishlists;
DROP POLICY IF EXISTS "Users can insert their own wishlists" ON public.wishlists;
DROP POLICY IF EXISTS "Users can delete their own wishlists" ON public.wishlists;
DROP POLICY IF EXISTS "Users can view their own wishlists" ON public.wishlists;
DROP POLICY IF EXISTS "Public wishlists are viewable" ON public.wishlists;
DROP POLICY IF EXISTS "Connections can view wishlists" ON public.wishlists;
DROP POLICY IF EXISTS "Staff can view all wishlists" ON public.wishlists;
DROP POLICY IF EXISTS "Public wishlists are viewable by anon" ON public.wishlists;
DROP POLICY IF EXISTS "Wishlists read policy" ON public.wishlists;
DROP POLICY IF EXISTS "Users can update their own wishlists" ON public.wishlists;

CREATE POLICY "Public wishlists are viewable by anon"
ON public.wishlists
FOR SELECT
TO anon
USING (
  get_wishlist_privacy(user_id) = 'public'
  AND NOT is_blocked_between(NULL, user_id)
);

CREATE POLICY "Wishlists read policy"
ON public.wishlists
FOR SELECT
TO authenticated
USING (
  (select auth.uid()) = user_id
  OR (
    get_wishlist_privacy(user_id) = 'public'
    AND NOT is_blocked_between((select auth.uid()), user_id)
  )
  OR (
    get_wishlist_privacy(user_id) = 'connections'
    AND EXISTS (
      SELECT 1 FROM connections c
      WHERE c.status = 'accepted'
        AND ((c.user_id_1 = (select auth.uid()) AND c.user_id_2 = wishlists.user_id)
          OR (c.user_id_2 = (select auth.uid()) AND c.user_id_1 = wishlists.user_id))
    )
  )
  OR is_staff_or_admin()
);

CREATE POLICY "Users can insert their own wishlists"
ON public.wishlists
FOR INSERT
TO authenticated
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own wishlists"
ON public.wishlists
FOR UPDATE
TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own wishlists"
ON public.wishlists
FOR DELETE
TO authenticated
USING ((select auth.uid()) = user_id);

-- ==========================================
-- 2. products (6 findings -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Enable write access for admin and owner" ON public.products;
DROP POLICY IF EXISTS "Public can only read visible active products" ON public.products;
DROP POLICY IF EXISTS "Anon can view active public products" ON public.products;
DROP POLICY IF EXISTS "Authenticated can view active public products or staff view all" ON public.products;
DROP POLICY IF EXISTS "Admin and owner can insert products" ON public.products;
DROP POLICY IF EXISTS "Admin and owner can update products" ON public.products;
DROP POLICY IF EXISTS "Admin and owner can delete products" ON public.products;

CREATE POLICY "Anon can view active public products"
ON public.products
FOR SELECT
TO anon
USING (deleted = false AND visibility = 'public');

CREATE POLICY "Authenticated can view active public products or staff view all"
ON public.products
FOR SELECT
TO authenticated
USING ((deleted = false AND visibility = 'public') OR is_staff_or_admin());

CREATE POLICY "Admin and owner can insert products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin and owner can update products"
ON public.products
FOR UPDATE
TO authenticated
USING (is_admin_or_owner())
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin and owner can delete products"
ON public.products
FOR DELETE
TO authenticated
USING (is_admin_or_owner());

-- ==========================================
-- 3. settings (6 findings -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.settings;
DROP POLICY IF EXISTS "Admin and owner can insert settings" ON public.settings;
DROP POLICY IF EXISTS "Admin and owner can update settings" ON public.settings;
DROP POLICY IF EXISTS "Admin and owner can delete settings" ON public.settings;

CREATE POLICY "Admin and owner can insert settings"
ON public.settings
FOR INSERT
TO authenticated
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin and owner can update settings"
ON public.settings
FOR UPDATE
TO authenticated
USING (is_admin_or_owner())
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin and owner can delete settings"
ON public.settings
FOR DELETE
TO authenticated
USING (is_admin_or_owner());

-- ==========================================
-- 4. pose_guide_products (6 findings -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Staff can manage pose_guide_products" ON public.pose_guide_products;
DROP POLICY IF EXISTS "Staff can insert pose_guide_products" ON public.pose_guide_products;
DROP POLICY IF EXISTS "Staff can update pose_guide_products" ON public.pose_guide_products;
DROP POLICY IF EXISTS "Staff can delete pose_guide_products" ON public.pose_guide_products;

CREATE POLICY "Staff can insert pose_guide_products"
ON public.pose_guide_products
FOR INSERT
TO authenticated
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update pose_guide_products"
ON public.pose_guide_products
FOR UPDATE
TO authenticated
USING (is_staff_or_admin())
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can delete pose_guide_products"
ON public.pose_guide_products
FOR DELETE
TO authenticated
USING (is_staff_or_admin());

-- ==========================================
-- 5. pose_guides (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.pose_guides;
DROP POLICY IF EXISTS "Staff can insert pose_guides" ON public.pose_guides;
DROP POLICY IF EXISTS "Staff can update pose_guides" ON public.pose_guides;
DROP POLICY IF EXISTS "Staff can delete pose_guides" ON public.pose_guides;

CREATE POLICY "Staff can insert pose_guides"
ON public.pose_guides
FOR INSERT
TO authenticated
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update pose_guides"
ON public.pose_guides
FOR UPDATE
TO authenticated
USING (is_staff_or_admin())
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can delete pose_guides"
ON public.pose_guides
FOR DELETE
TO authenticated
USING (is_staff_or_admin());

-- ==========================================
-- 6. ar_assets (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.ar_assets;
DROP POLICY IF EXISTS "Staff can insert ar_assets" ON public.ar_assets;
DROP POLICY IF EXISTS "Staff can update ar_assets" ON public.ar_assets;
DROP POLICY IF EXISTS "Staff can delete ar_assets" ON public.ar_assets;

CREATE POLICY "Staff can insert ar_assets"
ON public.ar_assets
FOR INSERT
TO authenticated
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update ar_assets"
ON public.ar_assets
FOR UPDATE
TO authenticated
USING (is_staff_or_admin())
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can delete ar_assets"
ON public.ar_assets
FOR DELETE
TO authenticated
USING (is_staff_or_admin());

-- ==========================================
-- 7. suggested_outfits (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.suggested_outfits;
DROP POLICY IF EXISTS "Staff can insert suggested_outfits" ON public.suggested_outfits;
DROP POLICY IF EXISTS "Staff can update suggested_outfits" ON public.suggested_outfits;
DROP POLICY IF EXISTS "Staff can delete suggested_outfits" ON public.suggested_outfits;

CREATE POLICY "Staff can insert suggested_outfits"
ON public.suggested_outfits
FOR INSERT
TO authenticated
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update suggested_outfits"
ON public.suggested_outfits
FOR UPDATE
TO authenticated
USING (is_staff_or_admin())
WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can delete suggested_outfits"
ON public.suggested_outfits
FOR DELETE
TO authenticated
USING (is_staff_or_admin());

-- ==========================================
-- 8. announcements (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Owner manages announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner can delete announcements" ON public.announcements;

CREATE POLICY "Owner can insert announcements"
ON public.announcements
FOR INSERT
TO authenticated
WITH CHECK (is_owner());

CREATE POLICY "Owner can update announcements"
ON public.announcements
FOR UPDATE
TO authenticated
USING (is_owner())
WITH CHECK (is_owner());

CREATE POLICY "Owner can delete announcements"
ON public.announcements
FOR DELETE
TO authenticated
USING (is_owner());

-- ==========================================
-- 9. store_closures (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Admin or owner can manage store closures" ON public.store_closures;
DROP POLICY IF EXISTS "Admin or owner can insert store closures" ON public.store_closures;
DROP POLICY IF EXISTS "Admin or owner can update store closures" ON public.store_closures;
DROP POLICY IF EXISTS "Admin or owner can delete store closures" ON public.store_closures;

CREATE POLICY "Admin or owner can insert store closures"
ON public.store_closures
FOR INSERT
TO authenticated
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin or owner can update store closures"
ON public.store_closures
FOR UPDATE
TO authenticated
USING (is_admin_or_owner())
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin or owner can delete store closures"
ON public.store_closures
FOR DELETE
TO authenticated
USING (is_admin_or_owner());

-- ==========================================
-- 10. store_hours (1 finding -> 0)
-- ==========================================
DROP POLICY IF EXISTS "Admin or owner can manage store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Admin or owner can insert store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Admin or owner can update store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Admin or owner can delete store hours" ON public.store_hours;

CREATE POLICY "Admin or owner can insert store hours"
ON public.store_hours
FOR INSERT
TO authenticated
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin or owner can update store hours"
ON public.store_hours
FOR UPDATE
TO authenticated
USING (is_admin_or_owner())
WITH CHECK (is_admin_or_owner());

CREATE POLICY "Admin or owner can delete store hours"
ON public.store_hours
FOR DELETE
TO authenticated
USING (is_admin_or_owner());
