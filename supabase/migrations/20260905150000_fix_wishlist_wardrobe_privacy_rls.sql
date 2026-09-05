-- Fixes a live bug in the wishlist_privacy/wardrobe_privacy RLS policies:
-- profiles' own SELECT policy is "own row or staff/admin", so a plain
-- customer cannot read another user's row at all. The public/connections
-- wishlist policies and the wardrobe connections policy all did a
-- correlated subquery straight against profiles from inside another
-- table's RLS, which therefore always read NULL for any non-owner,
-- non-staff viewer -- `NULL = 'public'` is never true, so these policies
-- could never actually grant access to the audience they exist for.
--
-- Confirmed live via adversarial role-impersonation testing (SET LOCAL
-- ROLE authenticated + a real non-staff profile id): a stranger saw 0 of
-- 3 items on a profile with wishlist_privacy = 'public', and a connected
-- user saw 0 of 14 items on a profile with wardrobe_privacy = 'connections'
-- and an accepted connection in place. Same root cause and fix as
-- get_outfit_privacy()/saved_outfits in the outfit-social-privacy branch.
CREATE OR REPLACE FUNCTION public.get_wishlist_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT wishlist_privacy FROM public.profiles WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_wardrobe_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT wardrobe_privacy FROM public.profiles WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_wishlist_privacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wishlist_privacy(uuid) TO authenticated, anon;
REVOKE ALL ON FUNCTION public.get_wardrobe_privacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wardrobe_privacy(uuid) TO authenticated, anon;

-- connections' own SELECT policy hides a 'blocked' row from the party who
-- got blocked, so a plain EXISTS(...) lookup run as the blocked user can
-- never find the row it needs. "Connections can view wishlists" and the
-- wardrobe connections policy both require status = 'accepted', which is
-- unaffected (accepted rows are visible to both parties normally) -- only
-- "Public wishlists are viewable" has no relationship check at all
-- otherwise, so it needs this SECURITY DEFINER accessor the same way
-- outfits' public policy does.
CREATE OR REPLACE FUNCTION public.is_blocked_between(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'blocked'
      AND (
        (c.user_id_1 = p_user_a AND c.user_id_2 = p_user_b)
        OR
        (c.user_id_1 = p_user_b AND c.user_id_2 = p_user_a)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "Public wishlists are viewable" ON public.wishlists;
CREATE POLICY "Public wishlists are viewable" ON public.wishlists FOR SELECT TO public
USING (
  public.get_wishlist_privacy(wishlists.user_id) = 'public'
  AND NOT public.is_blocked_between((select auth.uid()), wishlists.user_id)
);

DROP POLICY IF EXISTS "Connections can view wishlists" ON public.wishlists;
CREATE POLICY "Connections can view wishlists" ON public.wishlists FOR SELECT TO public
USING (
  public.get_wishlist_privacy(wishlists.user_id) = 'connections'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'accepted'
      AND (
        (c.user_id_1 = (select auth.uid()) AND c.user_id_2 = wishlists.user_id)
        OR
        (c.user_id_2 = (select auth.uid()) AND c.user_id_1 = wishlists.user_id)
      )
  )
);

DROP POLICY IF EXISTS "Enable SELECT for mutual connections on shared wardrobes" ON public.wardrobe_items;
CREATE POLICY "Enable SELECT for mutual connections on shared wardrobes" ON public.wardrobe_items FOR SELECT TO public
USING (
  public.get_wardrobe_privacy(wardrobe_items.user_id) = 'connections'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'accepted'
      AND (
        (c.user_id_1 = (select auth.uid()) AND c.user_id_2 = wardrobe_items.user_id)
        OR
        (c.user_id_1 = wardrobe_items.user_id AND c.user_id_2 = (select auth.uid()))
      )
  )
);
