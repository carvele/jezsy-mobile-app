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

-- profiles' own SELECT policy only allows a row's owner or staff to read it,
-- so a policy elsewhere that reads profiles.outfit_privacy via a plain
-- correlated subquery gets NULL for any other viewer and silently fails
-- closed. SECURITY DEFINER accessors bypass that, matching the same fix
-- already applied to wishlist_privacy/wardrobe_privacy.
CREATE OR REPLACE FUNCTION public.get_outfit_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT outfit_privacy FROM public.profiles WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_between(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- saved_outfits already has "Enable all access for own saved outfits or
-- admin" (ALL, owner + admin) -- these are additive SELECT policies for
-- everyone else.
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;
CREATE POLICY "Public outfits are viewable" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND public.get_outfit_privacy(user_id) = 'public'
  AND NOT public.is_blocked_between((select auth.uid()), user_id)
);

DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
CREATE POLICY "Connections can view outfits" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND public.get_outfit_privacy(user_id) = 'connections'
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
