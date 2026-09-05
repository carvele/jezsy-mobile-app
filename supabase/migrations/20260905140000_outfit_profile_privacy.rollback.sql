DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS profile_visibility;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS outfit_privacy;
