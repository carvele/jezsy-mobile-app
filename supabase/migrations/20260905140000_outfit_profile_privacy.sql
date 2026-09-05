-- Tier 1 privacy foundation for outfit-first social discovery: separate
-- controls for outfit visibility and general profile discoverability,
-- following the same per-feature privacy-column pattern already used for
-- wardrobe_privacy/wishlist_privacy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS outfit_privacy text NOT NULL DEFAULT 'private'
    CHECK (outfit_privacy IN ('public', 'connections', 'private'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'private'));

-- saved_outfits already has "Enable all access for own saved outfits or
-- admin" (ALL, owner + admin) -- these are additive SELECT policies for
-- everyone else. Using the same accepted-only connections join as
-- wardrobe_items/wishlists means a 'blocked' connection status never
-- satisfies status = 'accepted', so blocked users are excluded from both
-- policies with no extra guard needed.
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;
CREATE POLICY "Public outfits are viewable" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND (SELECT outfit_privacy FROM public.profiles WHERE id = saved_outfits.user_id) = 'public'
);

DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
CREATE POLICY "Connections can view outfits" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND (SELECT outfit_privacy FROM public.profiles WHERE id = saved_outfits.user_id) = 'connections'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'accepted'
      AND (
        (c.user_id_1 = (select auth.uid()) AND c.user_id_2 = saved_outfits.user_id)
        OR
        (c.user_id_2 = (select auth.uid()) AND c.user_id_1 = saved_outfits.user_id)
      )
  )
);
