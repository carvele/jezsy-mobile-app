-- Processing side of account_deletion_requests (20260729101500). That
-- migration deliberately left this unbuilt -- "The admin-dashboard repo owns
-- that processing surface" -- but nothing ever built it: filed requests sit
-- at status='pending' forever, and there is zero function/RPC anywhere that
-- can move one to 'completed'.
--
-- Split-treatment deletion, not a single hard DELETE, because a hard DELETE
-- of the profiles row cannot work for most real customers: reservations and
-- payments reference profiles with RESTRICT/NO ACTION delete rules (existing
-- schema, unchanged here), so Postgres itself refuses that operation for
-- anyone with reservation or payment history. That RESTRICT is also, not
-- incidentally, the correct outcome under GDPR Art. 17(3)(b)/(e): erasure is
-- not absolute where retention is needed for legal/accounting obligations or
-- to establish or defend a legal claim -- transaction records fall under
-- that exception in effectively every jurisdiction's tax law, and match
-- standard industry practice (e.g. Shopify retains order records after a
-- customer closes their account).
--
-- So: erase what's purely personal with no retention interest, anonymize
-- (sever the identity link, keep content) what has an ongoing audit/business
-- interest independent of who the person was, leave reservations/payments/
-- conversations untouched, and scrub-not-delete the profiles row itself,
-- since it has to survive as the anchor those untouched tables still point
-- to. Note the CASCADE/SET NULL delete rules already on some of these FKs
-- (user_measurements, wishlists, reviews, etc.) never fire here, because the
-- profiles row is never actually deleted -- only updated. This function does
-- that work explicitly instead of relying on a cascade that can't trigger.
--
-- Does NOT touch auth.users -- that requires the GoTrue Admin API
-- (auth.admin.deleteUser), a service-role-only operation that cannot run
-- inside a plain Postgres function. That call belongs in a server-side
-- caller (Edge Function) after this RPC returns success, mirroring how
-- create-staff-account already splits "verify caller, then use a service-role
-- client for the privileged operation."

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

REVOKE EXECUTE ON FUNCTION public.process_account_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_account_deletion(uuid) TO authenticated;
