DROP POLICY IF EXISTS "Staff or admin can view logs" ON public.logs;
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.logs;
CREATE POLICY "Enable all access for admin/staff"
ON public.logs FOR ALL
USING (public.is_staff_or_admin())
WITH CHECK (public.is_staff_or_admin());

CREATE OR REPLACE FUNCTION public.update_staff_role(target_user_id uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  target_role text;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Only admins or owners can change staff roles';
  END IF;

  IF new_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Role must be "staff" or "admin"';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  SELECT role INTO target_role
  FROM public.profiles
  WHERE id = target_user_id AND deleted = false;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found or is deleted';
  END IF;

  IF target_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Cannot modify a % role', target_role;
  END IF;

  UPDATE public.profiles
  SET role = new_role, updated_at = now()
  WHERE id = target_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_reservation_balance(_reservation_id uuid, _method text DEFAULT 'cash'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res record;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  IF lower(COALESCE(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The deposit has not been paid yet.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = COALESCE(v_actor_name, 'Staff'),
      balance_settled_method = _method
  WHERE id = _reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;

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
