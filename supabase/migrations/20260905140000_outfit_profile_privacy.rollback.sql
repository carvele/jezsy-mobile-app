DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;

-- Not dropping is_blocked_between: 20260905150000_fix_wishlist_wardrobe_privacy_rls.sql
-- also owns/relies on this same function for wishlist/wardrobe policies.
DROP FUNCTION IF EXISTS public.get_outfit_privacy(uuid);

ALTER TABLE public.profiles DROP COLUMN IF EXISTS profile_visibility;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS outfit_privacy;
