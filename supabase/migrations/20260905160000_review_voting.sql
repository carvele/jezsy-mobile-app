-- Review Helpful/Not Helpful voting. reviews.likes/dislikes already exist
-- (display-only today, always 0 -- nothing writes them) and are reused as
-- the trigger-maintained aggregate counters instead of adding redundant
-- likes_count/dislikes_count columns.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_likes_non_negative'
  ) THEN
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_likes_non_negative CHECK (likes >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_dislikes_non_negative'
  ) THEN
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_dislikes_non_negative CHECK (dislikes >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.review_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vote_type text NOT NULL CHECK (vote_type IN ('like', 'dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);

CREATE INDEX IF NOT EXISTS review_votes_review_id_idx ON public.review_votes(review_id);

ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;

-- Completely locked down per the plan: no INSERT/UPDATE/DELETE policy for
-- authenticated at all -- every write goes through vote_on_review(), a
-- SECURITY DEFINER function that runs as the table owner and so isn't
-- subject to RLS. A user can only ever read their own vote, never anyone
-- else's (this is also what makes get_reviews_with_user_vote's plain
-- LEFT JOIN safe as SECURITY INVOKER -- the join can only ever surface the
-- caller's own vote row).
DROP POLICY IF EXISTS "Users can view their own votes" ON public.review_votes;
CREATE POLICY "Users can view their own votes" ON public.review_votes FOR SELECT TO public
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Staff can view all votes" ON public.review_votes;
CREATE POLICY "Staff can view all votes" ON public.review_votes FOR SELECT TO public
USING (public.is_staff_or_admin());

-- Delta-based: never recounts the table, just adjusts by the exact
-- transition (insert a vote, delete a vote, or flip like<->dislike).
CREATE OR REPLACE FUNCTION public.tr_review_votes_sync_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vote_type = 'like' THEN
      UPDATE public.reviews SET likes = likes + 1 WHERE id = NEW.review_id;
    ELSE
      UPDATE public.reviews SET dislikes = dislikes + 1 WHERE id = NEW.review_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.vote_type = 'like' THEN
      UPDATE public.reviews SET likes = GREATEST(0, likes - 1) WHERE id = OLD.review_id;
    ELSE
      UPDATE public.reviews SET dislikes = GREATEST(0, dislikes - 1) WHERE id = OLD.review_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.vote_type <> OLD.vote_type THEN
      IF OLD.vote_type = 'like' THEN
        UPDATE public.reviews SET likes = GREATEST(0, likes - 1), dislikes = dislikes + 1 WHERE id = NEW.review_id;
      ELSE
        UPDATE public.reviews SET dislikes = GREATEST(0, dislikes - 1), likes = likes + 1 WHERE id = NEW.review_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS review_votes_sync_counts ON public.review_votes;
CREATE TRIGGER review_votes_sync_counts
AFTER INSERT OR UPDATE OR DELETE ON public.review_votes
FOR EACH ROW EXECUTE FUNCTION public.tr_review_votes_sync_counts();

-- Trusted customer write path: SECURITY DEFINER with its own guards (auth
-- check, caller-derived user id -- never a parameter -- review-existence
-- check, self-vote rejection). p_vote_type = NULL removes the vote.
CREATE OR REPLACE FUNCTION public.vote_on_review(p_review_id uuid, p_vote_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_review_author uuid;
  v_likes int;
  v_dislikes int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_vote_type IS NOT NULL AND p_vote_type NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid vote type';
  END IF;

  SELECT user_id INTO v_review_author FROM public.reviews WHERE id = p_review_id;
  IF v_review_author IS NULL THEN
    RAISE EXCEPTION 'Review not found';
  END IF;
  IF v_review_author = v_uid THEN
    RAISE EXCEPTION 'You cannot vote on your own review';
  END IF;

  IF p_vote_type IS NULL THEN
    DELETE FROM public.review_votes WHERE review_id = p_review_id AND user_id = v_uid;
  ELSE
    INSERT INTO public.review_votes (review_id, user_id, vote_type)
    VALUES (p_review_id, v_uid, p_vote_type)
    ON CONFLICT (review_id, user_id)
    DO UPDATE SET vote_type = EXCLUDED.vote_type, updated_at = now()
    WHERE public.review_votes.vote_type IS DISTINCT FROM EXCLUDED.vote_type;
  END IF;

  SELECT likes, dislikes INTO v_likes, v_dislikes FROM public.reviews WHERE id = p_review_id;
  RETURN jsonb_build_object('likes', v_likes, 'dislikes', v_dislikes, 'user_vote', p_vote_type);
END;
$$;

REVOKE ALL ON FUNCTION public.vote_on_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vote_on_review(uuid, text) TO authenticated;

-- Read path: reviews are already publicly readable ("Anyone can view
-- reviews"), and review_votes' own RLS restricts the LEFT JOIN to only ever
-- surface the caller's own vote -- so plain SECURITY INVOKER is correct and
-- sufficient here, no elevated privilege needed.
CREATE OR REPLACE FUNCTION public.get_reviews_with_user_vote(p_product_id uuid)
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
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_reviews_with_user_vote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviews_with_user_vote(uuid) TO authenticated, anon;
