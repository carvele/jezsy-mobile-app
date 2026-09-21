-- Migration: 20260921120000_allow_review_per_reservation_item.sql
-- Allow verified reviews per reservation item rather than globally per (product_id, user_id).
-- Ensures that when a customer completes a new reservation containing a previously reviewed product,
-- or orders multiple items, each completed purchase can be rated independently.

-- 1. Drop the legacy unique constraint on (product_id, user_id)
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_product_user_key;

-- 2. Add unique constraint on reservation_item_id to prevent duplicate reviews for the same purchase item
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_reservation_item_unique'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reservation_item_unique UNIQUE (reservation_item_id);
  END IF;
END $$;

-- 3. Update submit_verified_review RPC to enforce uniqueness per reservation_item_id
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

  -- Staff transactional isolation: reject staff/admin/owner accounts
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot submit customer reviews. Please use a personal customer account.'
      USING ERRCODE = '42501';
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

  -- Proactive duplicate check per reservation item
  IF EXISTS (
    SELECT 1 FROM public.reviews
    WHERE reservation_item_id = p_reservation_item_id
  ) THEN
    RAISE EXCEPTION 'This reservation item has already been reviewed';
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
