-- Migration: 20260910320000_remediate_mpp_batch_f2
-- Remediation for Pass F - Batch F2 multiple permissive policies
-- Applies to tables: devices, saved_outfits, outfit_items, wardrobe_items, review_votes, connections

-- 1. Devices
DROP POLICY IF EXISTS "Admin or owner can manage devices" ON public.devices;
DROP POLICY IF EXISTS "Staff can view devices" ON public.devices;
DROP POLICY IF EXISTS "Devices staff view" ON public.devices;
CREATE POLICY "Devices staff view"
  ON public.devices
  FOR SELECT
  TO authenticated
  USING (is_staff_or_admin());

-- 2. Saved Outfits
DROP POLICY IF EXISTS "Enable all access for own saved outfits or admin" ON public.saved_outfits;
DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;
DROP POLICY IF EXISTS "Saved outfits insert" ON public.saved_outfits;
DROP POLICY IF EXISTS "Saved outfits update" ON public.saved_outfits;
DROP POLICY IF EXISTS "Saved outfits delete" ON public.saved_outfits;
DROP POLICY IF EXISTS "Saved outfits public read anon" ON public.saved_outfits;
DROP POLICY IF EXISTS "Saved outfits read" ON public.saved_outfits;

CREATE POLICY "Saved outfits insert"
  ON public.saved_outfits
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

CREATE POLICY "Saved outfits update"
  ON public.saved_outfits
  FOR UPDATE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_staff_or_admin())
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

CREATE POLICY "Saved outfits delete"
  ON public.saved_outfits
  FOR DELETE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

-- Guest public read (anon)
CREATE POLICY "Saved outfits public read anon"
  ON public.saved_outfits
  FOR SELECT
  TO anon
  USING (
    coalesce(deleted, false) = false
    AND get_outfit_privacy(user_id) = 'public'
    AND NOT public.is_blocked_between(NULL, user_id)
  );

-- Unified select for authenticated users
-- Intentional semantic tightening (Option B): coalesce(deleted, false) = false hides deleted rows for all callers, including owners and staff.
CREATE POLICY "Saved outfits read"
  ON public.saved_outfits
  FOR SELECT
  TO authenticated
  USING (
    coalesce(deleted, false) = false
    AND (
      (user_id = (SELECT auth.uid()))
      OR is_staff_or_admin()
      OR (
        get_outfit_privacy(user_id) = 'public'
        AND NOT public.is_blocked_between((SELECT auth.uid()), user_id)
      )
      OR (
        get_outfit_privacy(user_id) = 'connections'
        AND EXISTS (
          SELECT 1 FROM connections c
          WHERE ((c.user_id_1 = (SELECT auth.uid()) AND c.user_id_2 = saved_outfits.user_id)
              OR (c.user_id_2 = (SELECT auth.uid()) AND c.user_id_1 = saved_outfits.user_id))
            AND c.status = 'accepted'
        )
      )
    )
  );

-- 3. Outfit Items
DROP POLICY IF EXISTS "Owner manages their own outfit items" ON public.outfit_items;
DROP POLICY IF EXISTS "Outfit items inherit their outfit's visibility" ON public.outfit_items;
DROP POLICY IF EXISTS "Outfit items insert" ON public.outfit_items;
DROP POLICY IF EXISTS "Outfit items update" ON public.outfit_items;
DROP POLICY IF EXISTS "Outfit items delete" ON public.outfit_items;
DROP POLICY IF EXISTS "Outfit items read" ON public.outfit_items;

CREATE POLICY "Outfit items insert"
  ON public.outfit_items
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM saved_outfits so
    WHERE so.id = outfit_items.outfit_id
      AND (so.user_id = (SELECT auth.uid()) OR is_staff_or_admin())
  ));

CREATE POLICY "Outfit items update"
  ON public.outfit_items
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM saved_outfits so
    WHERE so.id = outfit_items.outfit_id
      AND (so.user_id = (SELECT auth.uid()) OR is_staff_or_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM saved_outfits so
    WHERE so.id = outfit_items.outfit_id
      AND (so.user_id = (SELECT auth.uid()) OR is_staff_or_admin())
  ));

CREATE POLICY "Outfit items delete"
  ON public.outfit_items
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM saved_outfits so
    WHERE so.id = outfit_items.outfit_id
      AND (so.user_id = (SELECT auth.uid()) OR is_staff_or_admin())
  ));

CREATE POLICY "Outfit items read"
  ON public.outfit_items
  FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM saved_outfits so
    WHERE so.id = outfit_items.outfit_id
  ));

-- 4. Wardrobe Items
DROP POLICY IF EXISTS "Enable all access for own wardrobe items or admin" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Enable SELECT for mutual connections on shared wardrobes" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Wardrobe items insert" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Wardrobe items update" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Wardrobe items delete" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Wardrobe items read" ON public.wardrobe_items;

CREATE POLICY "Wardrobe items insert"
  ON public.wardrobe_items
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

CREATE POLICY "Wardrobe items update"
  ON public.wardrobe_items
  FOR UPDATE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_staff_or_admin())
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

CREATE POLICY "Wardrobe items delete"
  ON public.wardrobe_items
  FOR DELETE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

CREATE POLICY "Wardrobe items read"
  ON public.wardrobe_items
  FOR SELECT
  TO authenticated
  USING (
    (user_id = (SELECT auth.uid()))
    OR is_staff_or_admin()
    OR (
      get_wardrobe_privacy(user_id) = 'connections'
      AND EXISTS (
        SELECT 1 FROM connections c
        WHERE ((c.user_id_1 = (SELECT auth.uid()) AND c.user_id_2 = wardrobe_items.user_id)
            OR (c.user_id_2 = (SELECT auth.uid()) AND c.user_id_1 = wardrobe_items.user_id))
          AND c.status = 'accepted'
      )
    )
  );

-- 5. Review Votes
DROP POLICY IF EXISTS "Users can view their own votes" ON public.review_votes;
DROP POLICY IF EXISTS "Staff can view all votes" ON public.review_votes;
DROP POLICY IF EXISTS "Review votes read" ON public.review_votes;

CREATE POLICY "Review votes read"
  ON public.review_votes
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_staff_or_admin());

-- 6. Connections
DROP POLICY IF EXISTS "Staff can view all connections" ON public.connections;
DROP POLICY IF EXISTS "Users can view their non-blocked connections" ON public.connections;
DROP POLICY IF EXISTS "Connections read" ON public.connections;

CREATE POLICY "Connections read"
  ON public.connections
  FOR SELECT
  TO authenticated
  USING (
    is_staff_or_admin()
    OR (
      ((user_id_1 = (SELECT auth.uid())) OR (user_id_2 = (SELECT auth.uid())))
      AND NOT (status = 'blocked' AND action_user_id <> (SELECT auth.uid()))
    )
  );
