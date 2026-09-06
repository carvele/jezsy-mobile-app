-- Fix REVIEW-002: Silent 50-review cap, no pagination
DROP FUNCTION IF EXISTS public.get_reviews_with_user_vote(uuid);

CREATE OR REPLACE FUNCTION public.get_reviews_with_user_vote(
  p_product_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (review public.reviews, user_vote text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r, rv.vote_type
  FROM public.reviews r
  LEFT JOIN public.review_votes rv ON rv.review_id = r.id AND rv.user_id = (select auth.uid())
  WHERE r.product_id = p_product_id
  ORDER BY r.is_pinned DESC NULLS LAST, r.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_reviews_with_user_vote(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviews_with_user_vote(uuid, int, int) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_review_stats(p_product_id uuid)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'count', COUNT(*),
    'average', COALESCE(AVG(rating), 0),
    'breakdown', ARRAY[
      COUNT(*) FILTER (WHERE rating = 1),
      COUNT(*) FILTER (WHERE rating = 2),
      COUNT(*) FILTER (WHERE rating = 3),
      COUNT(*) FILTER (WHERE rating = 4),
      COUNT(*) FILTER (WHERE rating = 5)
    ]
  )
  FROM public.reviews
  WHERE product_id = p_product_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_review_stats(uuid) TO authenticated, anon;
