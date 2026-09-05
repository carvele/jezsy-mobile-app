-- Replace the direct INSERT policy with a SECURITY DEFINER RPC that enforces
-- the unsettled balance check server-side.

DROP POLICY IF EXISTS "Users file own deletion request" ON public.account_deletion_requests;
-- Staff still need to manage them, so the "Staff manage deletion requests" policy remains.

CREATE OR REPLACE FUNCTION public.request_account_deletion(_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blocking_reservations integer;
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*) INTO v_blocking_reservations
  FROM public.reservations r
  WHERE r.customer_id = auth.uid()
    AND r.deleted = false
    AND lower(trim(r.status)) <> 'cancelled'
    AND r.balance_settled_at IS NULL
    AND (
      lower(trim(r.payment_status)) <> 'paid'
      OR
      (lower(trim(r.payment_type)) = 'deposit' AND r.rental_price > coalesce(r.deposit, 0))
    );

  IF v_blocking_reservations > 0 THEN
    RAISE EXCEPTION 'You cannot request account deletion while you have unsettled balances.';
  END IF;

  INSERT INTO public.account_deletion_requests (user_id, reason)
  VALUES (auth.uid(), coalesce(_reason, 'Requested by customer'))
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated;


-- Also fix the staff processing RPC to correctly check for unsettled balances
-- instead of just trusting the 'Completed' status.
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

  SELECT count(*) INTO v_blocking_reservations
  FROM public.reservations r
  WHERE r.customer_id = v_request.user_id
    AND r.deleted = false
    AND lower(trim(r.status)) <> 'cancelled'
    AND r.balance_settled_at IS NULL
    AND (
      lower(trim(r.payment_status)) <> 'paid'
      OR
      (lower(trim(r.payment_type)) = 'deposit' AND r.rental_price > coalesce(r.deposit, 0))
    );

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
  UPDATE public.logs SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.feedback SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.ar_sessions SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = v_request.user_id;
  UPDATE public.reviews SET user_id = NULL WHERE user_id = v_request.user_id;

  -- Scrub the profile itself
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
