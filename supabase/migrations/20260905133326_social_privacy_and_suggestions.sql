-- 1. Add wishlist_privacy to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wishlist_privacy text DEFAULT 'private' CHECK (wishlist_privacy IN ('public', 'connections', 'private'));

UPDATE public.profiles SET username = lower(username) WHERE username IS NOT NULL;

-- 2. Enforce lowercase usernames to prevent @Maria and @maria from being different
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_lowercase_chk CHECK (username = lower(username));

-- 3. Security Definer RPC for Suggestions
CREATE OR REPLACE FUNCTION public.get_suggested_connections()
RETURNS TABLE (
  id uuid,
  username text,
  first_name text,
  last_name text,
  mutual_count int
) AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH my_connections AS (
    SELECT 
      CASE WHEN user_id_1 = v_uid THEN user_id_2 ELSE user_id_1 END as conn_id
    FROM public.connections
    WHERE (user_id_1 = v_uid OR user_id_2 = v_uid)
      AND status = 'accepted'
  ),
  my_blocks AS (
    SELECT 
      CASE WHEN user_id_1 = v_uid THEN user_id_2 ELSE user_id_1 END as blocked_id
    FROM public.connections
    WHERE (user_id_1 = v_uid OR user_id_2 = v_uid)
      AND status = 'blocked'
  ),
  my_pending AS (
    SELECT 
      CASE WHEN user_id_1 = v_uid THEN user_id_2 ELSE user_id_1 END as pending_id
    FROM public.connections
    WHERE (user_id_1 = v_uid OR user_id_2 = v_uid)
      AND status = 'pending'
  ),
  excluded_users AS (
    SELECT conn_id as uid FROM my_connections
    UNION
    SELECT blocked_id as uid FROM my_blocks
    UNION
    SELECT pending_id as uid FROM my_pending
    UNION
    SELECT v_uid as uid -- Exclude self
  ),
  fof AS (
    -- Friends of friends
    SELECT 
      CASE WHEN c.user_id_1 IN (SELECT conn_id FROM my_connections) THEN c.user_id_2 ELSE c.user_id_1 END as fof_id
    FROM public.connections c
    WHERE (c.user_id_1 IN (SELECT conn_id FROM my_connections) OR c.user_id_2 IN (SELECT conn_id FROM my_connections))
      AND c.status = 'accepted'
  ),
  fof_counts AS (
    SELECT fof_id, COUNT(*) as mutuals
    FROM fof
    WHERE fof_id NOT IN (SELECT uid FROM excluded_users)
    GROUP BY fof_id
  ),
  active_users AS (
    SELECT p.id as active_id, 0 as mutuals
    FROM public.profiles p
    WHERE p.id NOT IN (SELECT uid FROM excluded_users)
      AND p.id NOT IN (SELECT fof_id FROM fof_counts)
    ORDER BY p.updated_at DESC
    LIMIT 20
  ),
  combined AS (
    SELECT fof_id as user_id, mutuals::int FROM fof_counts
    UNION ALL
    SELECT active_id as user_id, mutuals::int FROM active_users
  )
  SELECT 
    p.id, p.username, p.first_name, p.last_name, c.mutuals
  FROM combined c
  JOIN public.profiles p ON p.id = c.user_id
  ORDER BY c.mutuals DESC, p.updated_at DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Wishlist RLS updates for social visibility
DROP POLICY IF EXISTS "Public wishlists are viewable" ON public.wishlists;
CREATE POLICY "Public wishlists are viewable" ON public.wishlists FOR SELECT TO public
USING (
  (SELECT wishlist_privacy FROM public.profiles WHERE id = wishlists.user_id) = 'public'
);

DROP POLICY IF EXISTS "Connections can view wishlists" ON public.wishlists;
CREATE POLICY "Connections can view wishlists" ON public.wishlists FOR SELECT TO public
USING (
  (SELECT wishlist_privacy FROM public.profiles WHERE id = wishlists.user_id) = 'connections'
  AND EXISTS (
    SELECT 1 FROM public.connections 
    WHERE status = 'accepted' 
      AND (
        (user_id_1 = (select auth.uid()) AND user_id_2 = wishlists.user_id) 
        OR 
        (user_id_2 = (select auth.uid()) AND user_id_1 = wishlists.user_id)
      )
  )
);
