-- Two gaps found reviewing the account-deletion flow end to end:
--
-- 1. process_account_deletion nulled messages.sender_id on identity erasure
-- but never touched conversations.customer_id, so a conversation thread
-- stayed permanently resolvable to a specific (scrubbed) customer even
-- though every message inside it lost its sender -- an inconsistent
-- application of the same "sever the identity link" policy the original
-- migration's own comment describes.
--
-- 2. Staff had no way to decline a deletion request. The only "un-pending"
-- paths were this RPC (-> completed) and the customer's own withdraw (a
-- hard DELETE). account_deletion_requests.status already allows 'cancelled'
-- per its own CHECK constraint; nothing ever wrote it. A request staff want
-- to refuse (fraud/abuse suspicion, pending investigation) just sat pending
-- forever with no code path to move it.

CREATE OR REPLACE FUNCTION public.process_account_deletion(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  UPDATE public.logs SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.feedback SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.ar_sessions SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = v_request.user_id;
  UPDATE public.reviews SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.conversations SET customer_id = NULL WHERE customer_id = v_request.user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.reject_account_deletion_request(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request record;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff can reject account deletion requests.';
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

  UPDATE public.account_deletion_requests
  SET status = 'cancelled', processed_at = now(), processed_by = auth.uid()
  WHERE id = _request_id;

  RETURN jsonb_build_object('rejected', true, 'user_id', v_request.user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_account_deletion_request(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reject_account_deletion_request(uuid) TO authenticated;
