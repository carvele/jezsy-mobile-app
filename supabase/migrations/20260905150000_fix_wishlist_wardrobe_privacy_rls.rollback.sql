DROP POLICY IF EXISTS "Enable SELECT for mutual connections on shared wardrobes" ON public.wardrobe_items;
CREATE POLICY "Enable SELECT for mutual connections on shared wardrobes" ON public.wardrobe_items FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = wardrobe_items.user_id AND p.wardrobe_privacy = 'connections'
  )
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'accepted'
      AND (
        (c.user_id_1 = auth.uid() AND c.user_id_2 = wardrobe_items.user_id)
        OR
        (c.user_id_1 = wardrobe_items.user_id AND c.user_id_2 = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "Connections can view wishlists" ON public.wishlists;
CREATE POLICY "Connections can view wishlists" ON public.wishlists FOR SELECT TO public
USING (
  (SELECT profiles.wishlist_privacy FROM public.profiles WHERE profiles.id = wishlists.user_id) = 'connections'
  AND EXISTS (
    SELECT 1 FROM public.connections
    WHERE connections.status = 'accepted'
      AND (
        (connections.user_id_1 = (select auth.uid()) AND connections.user_id_2 = wishlists.user_id)
        OR
        (connections.user_id_2 = (select auth.uid()) AND connections.user_id_1 = wishlists.user_id)
      )
  )
);

DROP POLICY IF EXISTS "Public wishlists are viewable" ON public.wishlists;
CREATE POLICY "Public wishlists are viewable" ON public.wishlists FOR SELECT TO public
USING (
  (SELECT profiles.wishlist_privacy FROM public.profiles WHERE profiles.id = wishlists.user_id) = 'public'
);

DROP FUNCTION IF EXISTS public.is_blocked_between(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_wardrobe_privacy(uuid);
DROP FUNCTION IF EXISTS public.get_wishlist_privacy(uuid);
