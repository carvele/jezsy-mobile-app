-- Revert process_account_deletion to original version without balance checking
CREATE OR REPLACE FUNCTION public.process_account_deletion(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request record;
  v_blocking_reservations integer;
  v_blocking_payments integer;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff can process account deletion requests.';
  END IF;

  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deletion request not found.';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been processed.';
  END IF;

  -- Blocking = money or a booking still in flight. 'Completed'/'Cancelled'
  -- reservations and settled/dead payments ('paid', 'failed', 'cancelled',
  -- 'refunded') are historical records, not open obligations -- they don't
  -- block, they're exactly what gets retained untouched below.
  SELECT count(*) INTO v_blocking_reservations
  FROM public.reservations
  WHERE customer_id = v_request.user_id
    AND status NOT IN ('Completed', 'Cancelled');

  SELECT count(*) INTO v_blocking_payments
  FROM public.payments
  WHERE user_id = v_request.user_id
    AND status IN ('awaiting_payment', 'processing');

  IF v_blocking_reservations > 0 OR v_blocking_payments > 0 THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'blocking_reservations', v_blocking_reservations,
      'blocking_payments', v_blocking_payments
    );
  END IF;

  -- Erase outright: personal, non-transactional data with no retention need.
  DELETE FROM public.user_measurements WHERE user_id = v_request.user_id;
  DELETE FROM public.wishlists WHERE user_id = v_request.user_id;
  DELETE FROM public.wardrobe_items WHERE user_id = v_request.user_id;
  DELETE FROM public.saved_outfits WHERE user_id = v_request.user_id;
  DELETE FROM public.capsule_items
    WHERE capsule_id IN (SELECT id FROM public.capsules WHERE user_id = v_request.user_id);
  DELETE FROM public.capsules WHERE user_id = v_request.user_id;
  DELETE FROM public.notifications WHERE user_id = v_request.user_id;
  DELETE FROM public.stock_notify_requests WHERE user_id = v_request.user_id;
  DELETE FROM public.announcement_dismissals WHERE user_id = v_request.user_id;
  DELETE FROM public.user_streaks WHERE user_id = v_request.user_id;

  -- Anonymize: records with an ongoing audit/business/product interest
  -- independent of who specifically the person was. Content stays, identity
  -- link is severed.
  UPDATE public.logs SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.feedback SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.ar_sessions SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = v_request.user_id;
  -- Reviews specifically: kept for their product-rating value to other
  -- shoppers (same reasoning the verified-purchase gate in
  -- 20260808071552_reviews_require_reservation_on_insert relies on --
  -- reviewer_name is already denormalized onto the row precisely because
  -- profiles access is restricted). Standard practice: Amazon/Shopify retain
  -- reviews after account deletion under a generic "Customer" byline.
  UPDATE public.reviews SET user_id = NULL WHERE user_id = v_request.user_id;

  -- Deliberately untouched: reservations, payments, conversations. Their FK
  -- still resolves correctly -- to the now-scrubbed profile row below, not a
  -- live identity.

  -- Scrub the profile itself rather than delete the row, which the
  -- RESTRICT/NO ACTION FKs above would refuse for any customer with booking
  -- or payment history.
  UPDATE public.profiles
  SET
    first_name = NULL,
    last_name = NULL,
    email = NULL,
    phone = NULL,
    address_line = NULL,
    barangay = NULL,
    city = NULL,
    province = NULL,
    zip_code = NULL,
    date_of_birth = NULL,
    gender = NULL,
    employment_status = NULL,
    fit_preference = NULL,
    expo_push_token = NULL,
    deleted = true,
    updated_at = now()
  WHERE id = v_request.user_id;

  UPDATE public.account_deletion_requests
  SET status = 'completed', processed_at = now(), processed_by = auth.uid()
  WHERE id = _request_id;

  RETURN jsonb_build_object('blocked', false, 'user_id', v_request.user_id);
END;
$$;

-- Drop the new request RPC
DROP FUNCTION IF EXISTS public.request_account_deletion(text);

-- Recreate the direct INSERT policy
CREATE POLICY "Users file own deletion request"
  ON public.account_deletion_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');
