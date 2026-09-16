-- Migration: 20260917000000_remove_connections_and_decouple_privacy.sql
-- Description: Permanently removes the social connections feature and decouples database
-- policies, functions, constraints, and tables. Ensures fail-closed privacy across profiles
-- (migrating 'connections' to 'private'), and cleanly drops the connections table.

-- 1. Fail-closed privacy migration on profiles
UPDATE public.profiles
SET wardrobe_privacy = 'private'
WHERE wardrobe_privacy = 'connections';

UPDATE public.profiles
SET wishlist_privacy = 'private'
WHERE wishlist_privacy = 'connections';

UPDATE public.profiles
SET outfit_privacy = 'private'
WHERE outfit_privacy = 'connections';

-- 2. Update CHECK constraints on profiles to forbid 'connections'
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_wardrobe_privacy_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_wardrobe_privacy_check
  CHECK (wardrobe_privacy = ANY (ARRAY['private'::text]));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_wishlist_privacy_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_wishlist_privacy_check
  CHECK (wishlist_privacy = ANY (ARRAY['public'::text, 'private'::text]));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_outfit_privacy_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_outfit_privacy_check
  CHECK (outfit_privacy = ANY (ARRAY['public'::text, 'private'::text]));

-- 3. Decouple RLS policies from connections table

-- 3a. wishlists
DROP POLICY IF EXISTS "Wishlists read policy" ON public.wishlists;
CREATE POLICY "Wishlists read policy"
ON public.wishlists
FOR SELECT
TO authenticated
USING (
  ((SELECT auth.uid() AS uid) = user_id)
  OR ((public.get_wishlist_privacy(user_id) = 'public'::text) AND (NOT public.is_blocked_between((SELECT auth.uid() AS uid), user_id)))
  OR public.is_staff_or_admin()
);

-- 3b. saved_outfits
DROP POLICY IF EXISTS "Saved outfits read" ON public.saved_outfits;
CREATE POLICY "Saved outfits read"
ON public.saved_outfits
FOR SELECT
TO authenticated
USING (
  (COALESCE(deleted, false) = false)
  AND (
    (user_id = (SELECT auth.uid() AS uid))
    OR public.is_staff_or_admin()
    OR ((public.get_outfit_privacy(user_id) = 'public'::text) AND (NOT public.is_blocked_between((SELECT auth.uid() AS uid), user_id)))
  )
);

-- 3c. wardrobe_items
DROP POLICY IF EXISTS "Wardrobe items read" ON public.wardrobe_items;
CREATE POLICY "Wardrobe items read"
ON public.wardrobe_items
FOR SELECT
TO authenticated
USING (
  (user_id = (SELECT auth.uid() AS uid))
  OR public.is_staff_or_admin()
);

-- 3d. direct_chat_participants & direct_messages
DROP POLICY IF EXISTS "Users can add participants if mutual connection exists" ON public.direct_chat_participants;
CREATE POLICY "Users can add participants if mutual connection exists"
ON public.direct_chat_participants
FOR INSERT
TO authenticated
WITH CHECK (
  ((SELECT auth.uid() AS uid) = user_id)
);

DROP POLICY IF EXISTS "Users can send messages to connections" ON public.direct_messages;
CREATE POLICY "Users can send messages to connections"
ON public.direct_messages
FOR INSERT
TO authenticated
WITH CHECK (
  (sender_id = (SELECT auth.uid() AS uid))
  AND public.is_chat_participant(chat_id, (SELECT auth.uid() AS uid))
);

-- 4. Drop or update functions referencing connections

-- 4a. Drop get_suggested_connections
DROP FUNCTION IF EXISTS public.get_suggested_connections();

-- 4b. Update get_product_loved_by (remove connections table reference)
CREATE OR REPLACE FUNCTION public.get_product_loved_by(p_product_id uuid)
 RETURNS TABLE(total_count integer, public_users json)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH valid_wishlists AS (
    SELECT w.user_id, p.username, p.first_name, p.last_name, p.wishlist_privacy, p.profile_visibility
    FROM public.wishlists w
    JOIN public.profiles p ON p.id = w.user_id
    WHERE w.product_id = p_product_id
      AND coalesce(p.deleted, false) = false
      AND coalesce(p.is_blocked, false) = false
  ),
  total AS (
    SELECT count(*)::int as c FROM valid_wishlists
  ),
  public_fans AS (
    SELECT 
      p.id, 
      p.username, 
      p.first_name, 
      p.last_name,
      w.created_at AS loved_at,
      w.id AS wishlist_id
    FROM public.wishlists w
    JOIN public.profiles p ON p.id = w.user_id
    WHERE w.product_id = p_product_id
      AND p.wishlist_privacy = 'public'
      AND p.profile_visibility = 'public'
      AND coalesce(p.deleted, false) = false
      AND coalesce(p.is_blocked, false) = false
      AND w.user_id IS DISTINCT FROM v_uid
      AND (
        v_uid IS NULL
        OR NOT public.is_blocked_between(v_uid, w.user_id)
      )
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT 3
  )
  SELECT 
    (SELECT c FROM total),
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id', id,
            'username', username,
            'first_name', first_name,
            'last_name', last_name
          )
          ORDER BY loved_at DESC, wishlist_id DESC
        )
        FROM public_fans
      ),
      '[]'::json
    );
END;
$function$;

-- 4c. Update get_or_create_direct_chat (remove connection check)
CREATE OR REPLACE FUNCTION public.get_or_create_direct_chat(other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_chat_id uuid;
    v_lock_key bigint;
BEGIN
    IF other_user_id IS NULL OR other_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Invalid target user for direct chat';
    END IF;

    -- MSG-001: Acquire transaction-level advisory lock on the unique pair
    -- to serialize concurrent calls from the two users and prevent duplicate chat rows.
    v_lock_key := hashtext(least(auth.uid()::text, other_user_id::text) || greatest(auth.uid()::text, other_user_id::text));
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Look for existing chat where both are participants
    SELECT c.id INTO v_chat_id
    FROM public.direct_chats c
    JOIN public.direct_chat_participants p1 ON p1.chat_id = c.id AND p1.user_id = auth.uid()
    JOIN public.direct_chat_participants p2 ON p2.chat_id = c.id AND p2.user_id = other_user_id;

    -- If not found, create new chat
    IF v_chat_id IS NULL THEN
        INSERT INTO public.direct_chats DEFAULT VALUES RETURNING id INTO v_chat_id;
        
        INSERT INTO public.direct_chat_participants (chat_id, user_id) 
        VALUES (v_chat_id, auth.uid()), (v_chat_id, other_user_id);
    END IF;

    RETURN v_chat_id;
END;
$function$;

-- 4d. Update is_blocked_between to return false (no connections table blocking)
CREATE OR REPLACE FUNCTION public.is_blocked_between(p_user_a uuid, p_user_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL THEN
    RETURN false;
  END IF;

  IF auth.uid() IS NULL OR (auth.uid() <> p_user_a AND auth.uid() <> p_user_b) THEN
    IF NOT public.is_staff_or_admin() THEN
      RAISE EXCEPTION 'Not authorized to query relationship status between third parties'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN false;
END;
$function$;

-- 5. Drop triggers and functions on connections
DROP TRIGGER IF EXISTS connections_prevent_self_accept ON public.connections;
DROP FUNCTION IF EXISTS public.prevent_self_accept();

DROP TRIGGER IF EXISTS connections_updated_at ON public.connections;
DROP FUNCTION IF EXISTS public.set_connections_updated_at();

-- 6. Drop policies on connections
DROP POLICY IF EXISTS "Connections read" ON public.connections;
DROP POLICY IF EXISTS "Users can insert pending connections" ON public.connections;
DROP POLICY IF EXISTS "Users can update their connections" ON public.connections;

-- 7. Drop connections table
DROP TABLE IF EXISTS public.connections CASCADE;
