-- Migration: 20260914010000_reviews_variant_attributes_and_filters.sql
-- Review Variant Attributes, Authoritative Provenance, Filtered Pagination & Facets

-- 1. Schema Extensions
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reservation_item_id uuid REFERENCES public.reservation_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS color text;

CREATE INDEX IF NOT EXISTS idx_reviews_reservation_item_id ON public.reviews(reservation_item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_size ON public.reviews(product_id, size) WHERE size IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_color ON public.reviews(product_id, color) WHERE color IS NOT NULL;

-- 2. Extend harden_reviews_update_trigger to freeze provenance fields on customer update
CREATE OR REPLACE FUNCTION public.harden_reviews_update_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- When invoked by a customer (authenticated user who is not staff/admin),
  -- lock all provenance and administrative fields to their previous values.
  IF auth.uid() IS NOT NULL AND NOT public.is_staff_or_admin() THEN
    NEW.verified_purchase = OLD.verified_purchase;
    NEW.admin_reply = OLD.admin_reply;
    NEW.is_pinned = OLD.is_pinned;
    NEW.likes = OLD.likes;
    NEW.dislikes = OLD.dislikes;
    NEW.product_id = OLD.product_id;
    NEW.user_id = OLD.user_id;
    NEW.reservation_item_id = OLD.reservation_item_id;
    NEW.size = OLD.size;
    NEW.color = OLD.color;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Conservative Historical Backfill
-- Only backfills reviews with exactly one unambiguous Completed reservation item.
UPDATE public.reviews r
SET
  reservation_item_id = sub.id,
  size = sub.size,
  color = sub.color,
  verified_purchase = true
FROM (
  SELECT ri.id, ri.size, ri.color, ri.product_id, res.customer_id
  FROM public.reservation_items ri
  JOIN public.reservations res ON res.id = ri.reservation_id
  WHERE res.status = 'Completed'
    AND coalesce(res.deleted, false) = false
) sub
WHERE r.user_id = sub.customer_id
  AND r.product_id = sub.product_id
  AND r.reservation_item_id IS NULL
  AND (
    SELECT count(*)
    FROM public.reservation_items ri2
    JOIN public.reservations res2 ON res2.id = ri2.reservation_id
    WHERE res2.customer_id = r.user_id
      AND ri2.product_id = r.product_id
      AND res2.status = 'Completed'
      AND coalesce(res2.deleted, false) = false
  ) = 1;

-- 4. Authoritative Review Submission RPC
-- Client supplies only reservationItemId; server derives product, size, color, verified_purchase.
CREATE OR REPLACE FUNCTION public.submit_verified_review(
  p_reservation_item_id uuid,
  p_rating int,
  p_comment text DEFAULT NULL,
  p_images text[] DEFAULT ARRAY[]::text[]
)
RETURNS public.reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_size text;
  v_color text;
  v_customer_id uuid;
  v_status text;
  v_new_review public.reviews;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- Verify reservation item exists and retrieve reservation state
  SELECT ri.product_id, ri.size, ri.color, res.customer_id, res.status
  INTO v_product_id, v_size, v_color, v_customer_id, v_status
  FROM public.reservation_items ri
  JOIN public.reservations res ON res.id = ri.reservation_id
  WHERE ri.id = p_reservation_item_id
    AND coalesce(res.deleted, false) = false;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Reservation item not found';
  END IF;

  IF v_customer_id <> v_uid THEN
    RAISE EXCEPTION 'You can only review items from your own reservations';
  END IF;

  IF v_status <> 'Completed' THEN
    RAISE EXCEPTION 'Only completed reservations can be reviewed';
  END IF;

  -- Proactive duplicate check
  IF EXISTS (
    SELECT 1 FROM public.reviews
    WHERE product_id = v_product_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'You have already reviewed this product';
  END IF;

  INSERT INTO public.reviews (
    product_id,
    user_id,
    reservation_item_id,
    size,
    color,
    rating,
    comment,
    images,
    verified_purchase
  ) VALUES (
    v_product_id,
    v_uid,
    p_reservation_item_id,
    v_size,
    v_color,
    p_rating,
    p_comment,
    p_images,
    true
  )
  RETURNING * INTO v_new_review;

  RETURN v_new_review;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verified_review(uuid, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_verified_review(uuid, integer, text, text[]) TO authenticated;

-- 5. Server-Side Filtered Offset Pagination RPC with Deterministic Sorting
DROP FUNCTION IF EXISTS public.get_reviews_with_user_vote(uuid, int, int);
DROP FUNCTION IF EXISTS public.get_reviews_with_user_vote(uuid, int, int, int, text, text, boolean, text);

CREATE OR REPLACE FUNCTION public.get_reviews_with_user_vote(
  p_product_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_rating int DEFAULT NULL,
  p_size text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_photos_only boolean DEFAULT false,
  p_sort text DEFAULT 'recent'
)
RETURNS TABLE (
  review public.reviews,
  user_vote text,
  total_filtered_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT
      r,
      rv.vote_type,
      COUNT(*) OVER() AS filtered_count
    FROM public.reviews r
    LEFT JOIN public.review_votes rv ON rv.review_id = r.id AND rv.user_id = (select auth.uid())
    WHERE r.product_id = p_product_id
      AND (p_rating IS NULL OR r.rating = p_rating)
      AND (p_size IS NULL OR r.size = p_size)
      AND (p_color IS NULL OR r.color = p_color)
      AND (NOT p_photos_only OR (r.images IS NOT NULL AND cardinality(r.images) > 0))
    ORDER BY
      r.is_pinned DESC NULLS LAST,
      CASE WHEN p_sort = 'highest' THEN r.rating END DESC NULLS LAST,
      CASE WHEN p_sort = 'lowest' THEN r.rating END ASC NULLS LAST,
      CASE WHEN p_sort = 'helpful' THEN COALESCE(r.likes, 0) END DESC NULLS LAST,
      r.created_at DESC,
      r.id DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT f.r, f.vote_type, f.filtered_count FROM filtered f;
$$;

REVOKE ALL ON FUNCTION public.get_reviews_with_user_vote(uuid, int, int, int, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviews_with_user_vote(uuid, int, int, int, text, text, boolean, text) TO authenticated, anon;

-- 6. Filter Facets RPC (Global product facet counts)
CREATE OR REPLACE FUNCTION public.get_review_filter_facets(p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'sizes', COALESCE(
      (SELECT jsonb_agg(s.size) FROM (
        SELECT DISTINCT size FROM public.reviews
        WHERE product_id = p_product_id AND size IS NOT NULL AND trim(size) <> ''
        ORDER BY size
      ) s),
      '[]'::jsonb
    ),
    'colors', COALESCE(
      (SELECT jsonb_agg(c.color) FROM (
        SELECT DISTINCT color FROM public.reviews
        WHERE product_id = p_product_id AND color IS NOT NULL AND trim(color) <> ''
        ORDER BY color
      ) c),
      '[]'::jsonb
    ),
    'photo_count', (
      SELECT COUNT(*) FROM public.reviews
      WHERE product_id = p_product_id AND images IS NOT NULL AND cardinality(images) > 0
    ),
    'total_count', (
      SELECT COUNT(*) FROM public.reviews
      WHERE product_id = p_product_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_review_filter_facets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_filter_facets(uuid) TO authenticated, anon;
