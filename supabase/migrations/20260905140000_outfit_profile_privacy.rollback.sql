DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;
DROP FUNCTION IF EXISTS public.is_blocked_between(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_outfit_privacy(uuid);

ALTER TABLE public.profiles DROP COLUMN IF EXISTS profile_visibility;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS outfit_privacy;
