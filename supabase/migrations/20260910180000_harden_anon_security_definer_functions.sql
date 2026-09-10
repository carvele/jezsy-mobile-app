-- ============================================================================
-- Migration: 20260910180000_harden_anon_security_definer_functions.sql
-- Description: Security Pass A1 — Hardening 17 Anonymous SECURITY DEFINER Functions
-- ============================================================================

-- Group 1: Internal Trigger Functions (5 Functions)
REVOKE ALL ON FUNCTION public.handle_auto_acknowledgment() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.harden_reviews_update_trigger()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.harden_reviews_update_trigger() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.prevent_self_accept() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tr_review_votes_sync_counts() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.tr_reviews_set_reviewer_name()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.tr_reviews_set_reviewer_name() FROM PUBLIC, anon, authenticated;


-- Group 2: Authenticated Helper Functions & RPCs (7 Functions)
REVOKE ALL ON FUNCTION public.is_admin_or_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner() TO authenticated;

REVOKE ALL ON FUNCTION public.is_staff_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_direct_chat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_chat(uuid) TO authenticated;

ALTER FUNCTION public.get_suggested_connections()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_suggested_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_suggested_connections() TO authenticated;

REVOKE ALL ON FUNCTION public.vote_on_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vote_on_review(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_wardrobe_privacy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wardrobe_privacy(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_chat_participant(p_chat_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_chat_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    IF NOT public.is_staff_or_admin() THEN
      RAISE EXCEPTION 'Not authorized to query chat membership for other users'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.direct_chat_participants
    WHERE chat_id = p_chat_id AND user_id = p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_chat_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_participant(uuid, uuid) TO authenticated;


-- Group 3: Privileged Staff / Admin Analytics RPC (1 Function)
CREATE OR REPLACE FUNCTION public.get_most_wishlisted_products()
RETURNS TABLE(product_id uuid, product_name text, image_url text, wishlist_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT w.product_id, p.name as product_name, p.image_url, count(w.id) as wishlist_count
  FROM public.wishlists w
  JOIN public.products p ON p.id = w.product_id
  GROUP BY w.product_id, p.name, p.image_url
  ORDER BY wishlist_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_most_wishlisted_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_most_wishlisted_products() TO authenticated;


-- Group 4: Accepted / Verified Intentional Public Functions (4 Functions)
-- SEC-A1-008: is_blocked_between
CREATE OR REPLACE FUNCTION public.is_blocked_between(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  RETURN EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'blocked'
      AND (
        (c.user_id_1 = p_user_a AND c.user_id_2 = p_user_b)
        OR
        (c.user_id_1 = p_user_b AND c.user_id_2 = p_user_a)
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_blocked_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO anon, authenticated;

-- SEC-A1-015: get_outfit_privacy
REVOKE ALL ON FUNCTION public.get_outfit_privacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_outfit_privacy(uuid) TO anon, authenticated;

-- SEC-A1-016: get_wishlist_privacy
REVOKE ALL ON FUNCTION public.get_wishlist_privacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wishlist_privacy(uuid) TO anon, authenticated;

-- SEC-A1-017: get_product_loved_by
CREATE OR REPLACE FUNCTION public.get_product_loved_by(p_product_id uuid)
RETURNS TABLE(total_count integer, public_users json)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
        OR NOT EXISTS (
          SELECT 1 FROM public.connections c
          WHERE c.status = 'blocked'
            AND (
              (c.user_id_1 = v_uid AND c.user_id_2 = w.user_id)
              OR (c.user_id_1 = w.user_id AND c.user_id_2 = v_uid)
            )
        )
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
$$;

REVOKE ALL ON FUNCTION public.get_product_loved_by(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_loved_by(uuid) TO anon, authenticated;
