-- CAP-REMOVE-003: Remove wear-streak gamification
-- Removes: user_streaks table, update_user_streak(), streak RLS/trigger.
-- Surgically patches: increment_wear_count, process_account_deletion.
-- Preserves: wear_count, last_worn_at, wardrobe_wear_logs, all wear history.

-- ============================================================
-- STEP 1: Replace increment_wear_count — drop PERFORM update_user_streak()
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_wear_count(p_item_id uuid)
 RETURNS wardrobe_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row wardrobe_items;
BEGIN
  UPDATE wardrobe_items
  SET wear_count = wear_count + 1,
      last_worn_at = now()
  WHERE id = p_item_id
    AND user_id = auth.uid()
    AND deleted = false
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wardrobe item % not found or not owned by caller', p_item_id;
  END IF;

  RETURN v_row;
END;
$function$;

-- ============================================================
-- STEP 2: Replace process_account_deletion — drop user_streaks DELETE
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_account_deletion(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_request record;
  v_target record;
  v_blocking_reservations integer;
  v_blocking_payments integer;
  v_actor_profile record;
  v_actor_name text;
BEGIN
  -- 1. Capability Authorization
  IF NOT public.can_manage_customers() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators on approved devices can process account deletion.';
  END IF;

  -- 2. Lock & Validate Deletion Request
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

  -- 3. Lock & Validate Target Profile
  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target customer profile not found.';
  END IF;

  IF v_target.role <> 'customer' THEN
    RAISE EXCEPTION 'Target account is not a customer (role: %). Cannot process deletion through customer deletion pipeline.', v_target.role;
  END IF;

  -- 4. Check Outstanding Obligations
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
    -- Request remains in status 'pending'
    RETURN jsonb_build_object(
      'blocked', true,
      'blocking_reservations', v_blocking_reservations,
      'blocking_payments', v_blocking_payments
    );
  END IF;

  -- 5. Irreversible Child Data Erasure
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
  -- user_streaks removed: table no longer exists after this migration

  -- 6. Anonymize Business & Product Interest Records
  UPDATE public.logs SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.feedback SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.ar_sessions SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = v_request.user_id;
  UPDATE public.reviews SET user_id = NULL WHERE user_id = v_request.user_id;

  -- 7. Scrub the Profile Row
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

  -- 8. Transition Request Status to auth_revocation_pending
  UPDATE public.account_deletion_requests
  SET
    status = 'auth_revocation_pending',
    processed_at = now(),
    processed_by = auth.uid()
  WHERE id = _request_id;

  -- 9. Record Immutable Audit Log
  SELECT first_name, last_name
  INTO v_actor_profile
  FROM public.profiles
  WHERE id = auth.uid();

  v_actor_name := COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', v_actor_profile.first_name, v_actor_profile.last_name)), ''),
    'Administrator'
  );

  INSERT INTO public.logs (
    user_id,
    user_name,
    action,
    target_type,
    target_id,
    details,
    timestamp
  ) VALUES (
    auth.uid(),
    v_actor_name,
    'account_deletion_scrubbed',
    'account_deletion_request',
    _request_id::text,
    jsonb_build_object(
      'target_user_id', v_request.user_id,
      'reason', v_request.reason
    ),
    now()
  );

  RETURN jsonb_build_object('blocked', false, 'user_id', v_request.user_id);
END;
$function$;

-- ============================================================
-- STEP 3: Drop update_user_streak function
-- ============================================================
DROP FUNCTION IF EXISTS public.update_user_streak();

-- ============================================================
-- STEP 4: Drop RLS policies on user_streaks
-- ============================================================
DROP POLICY IF EXISTS "Users can view own streaks" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can insert own streaks" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can update own streaks" ON public.user_streaks;

-- ============================================================
-- STEP 5: Drop trigger on user_streaks
-- ============================================================
DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.user_streaks;

-- ============================================================
-- STEP 6: Drop user_streaks table (NO CASCADE — fail loud on hidden deps)
-- ============================================================
DROP TABLE IF EXISTS public.user_streaks;
