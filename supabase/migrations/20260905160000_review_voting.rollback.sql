DROP FUNCTION IF EXISTS public.get_reviews_with_user_vote(uuid);
DROP FUNCTION IF EXISTS public.vote_on_review(uuid, text);
DROP TRIGGER IF EXISTS review_votes_sync_counts ON public.review_votes;
DROP FUNCTION IF EXISTS public.tr_review_votes_sync_counts();
DROP TABLE IF EXISTS public.review_votes;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_likes_non_negative;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_dislikes_non_negative;
