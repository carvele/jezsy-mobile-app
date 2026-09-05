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

-- profiles' own SELECT policy is "own row or staff/admin" -- a plain
-- customer cannot read another customer's row at all, which means a
-- correlated subquery straight against profiles from inside another
-- table's RLS (e.g. `(SELECT outfit_privacy FROM profiles WHERE id = ...)`)
-- silently returns NULL for every non-owner, non-staff viewer, so
-- `NULL = 'public'` is never true and the policy can never actually grant
-- access to the audience it exists for. Confirmed live via adversarial
-- role-impersonation testing (SET LOCAL ROLE authenticated + a real
-- non-staff profile id): the direct-subquery version of this policy showed
-- 0 rows for a stranger even with outfit_privacy = 'public'. A SECURITY
-- DEFINER accessor, mirroring is_staff_or_admin()'s existing pattern, is
-- the fix -- it reads the single column on the caller's behalf without
-- being subject to profiles' own row-level restriction.
CREATE OR REPLACE FUNCTION public.get_outfit_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT outfit_privacy FROM public.profiles WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_outfit_privacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_outfit_privacy(uuid) TO authenticated, anon;

-- connections' own SELECT policy ("Users can view their non-blocked
-- connections") deliberately hides a 'blocked' row from the party who got
-- blocked -- correct for "don't tell D that A blocked them" as a UI matter,
-- but it means a plain EXISTS(...) lookup against connections, run as D,
-- can never find the very row it needs to see D is blocked. Confirmed live:
-- the direct-EXISTS version of the public-outfits policy let a blocked
-- viewer straight through. Same SECURITY DEFINER fix as get_outfit_privacy,
-- applied to the relationship check instead of a column read.
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

-- saved_outfits already has "Enable all access for own saved outfits or
-- admin" (ALL, owner + admin) -- these are additive SELECT policies for
-- everyone else. The connections policy's status = 'accepted' condition
-- already excludes a 'blocked' relationship on its own, but "public" is
-- global (no relationship check at all otherwise), so it needs its own
-- explicit blocked-pair exclusion -- unlike wardrobe_items/wishlists'
-- equivalent public policies, which have this same gap.
DROP POLICY IF EXISTS "Public outfits are viewable" ON public.saved_outfits;
CREATE POLICY "Public outfits are viewable" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND public.get_outfit_privacy(saved_outfits.user_id) = 'public'
  AND NOT public.is_blocked_between((select auth.uid()), saved_outfits.user_id)
);

DROP POLICY IF EXISTS "Connections can view outfits" ON public.saved_outfits;
CREATE POLICY "Connections can view outfits" ON public.saved_outfits FOR SELECT TO public
USING (
  COALESCE(deleted, false) = false
  AND public.get_outfit_privacy(saved_outfits.user_id) = 'connections'
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
