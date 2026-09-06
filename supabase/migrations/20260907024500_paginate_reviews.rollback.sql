DROP FUNCTION IF EXISTS public.get_reviews_with_user_vote(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_reviews_with_user_vote(p_product_id uuid)
RETURNS TABLE (review public.reviews, user_vote text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS 
  SELECT r, rv.vote_type
  FROM public.reviews r
  LEFT JOIN public.review_votes rv ON rv.review_id = r.id AND rv.user_id = (select auth.uid())
  WHERE r.product_id = p_product_id
  ORDER BY r.is_pinned DESC NULLS LAST, r.created_at DESC
  LIMIT 50;
;

REVOKE ALL ON FUNCTION public.get_reviews_with_user_vote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviews_with_user_vote(uuid) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.get_review_stats(uuid);
