-- profiles' own SELECT policy only allows a row's owner or staff to read it
-- (auth.uid() = id OR is_staff_or_admin()). The social feature added this
-- session (network.tsx, user/[id].tsx, chat/[id].tsx, messages.tsx) reads
-- OTHER users' profiles rows directly from the client, which resolves to
-- zero rows for any non-staff user under that policy.
--
-- profiles also holds real PII (address_line, city, date_of_birth,
-- expo_push_token, etc), so a blanket "authenticated can SELECT profiles"
-- policy would leak all of it -- Postgres RLS is row-level, not
-- column-level. Instead, narrow SECURITY DEFINER accessors expose only the
-- handful of display fields the social feature actually needs, matching
-- this project's existing get_wishlist_privacy/is_blocked_between pattern.

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_user_ids uuid[])
RETURNS TABLE (id uuid, username text, first_name text, last_name text, wardrobe_privacy text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.username, p.first_name, p.last_name, p.wardrobe_privacy
  FROM public.profiles p
  WHERE p.id = ANY(p_user_ids)
    AND COALESCE(p.deleted, false) = false
    AND COALESCE(p.is_blocked, false) = false;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_public_profiles(p_query text, p_exclude_id uuid)
RETURNS TABLE (id uuid, username text, first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.username, p.first_name, p.last_name
  FROM public.profiles p
  WHERE (p.username ILIKE '%' || p_query || '%'
      OR p.first_name ILIKE '%' || p_query || '%'
      OR p.last_name ILIKE '%' || p_query || '%')
    AND p.id != p_exclude_id
    AND COALESCE(p.deleted, false) = false
    AND COALESCE(p.is_blocked, false) = false
  LIMIT 20;
$$;

REVOKE EXECUTE ON FUNCTION public.search_public_profiles(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_public_profiles(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM public.profiles p
  WHERE p.username = p_username AND COALESCE(p.deleted, false) = false
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_username(text) TO authenticated;
