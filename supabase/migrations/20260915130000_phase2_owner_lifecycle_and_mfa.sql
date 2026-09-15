-- Phase 2 Owner Lifecycle, MFA Quorum, Step-Up Receipts, and AAL2 Enforcement
-- Migration: 20260915130000_phase2_owner_lifecycle_and_mfa.sql

-- 1. Create MFA Reset Reservation Status enum & table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mfa_reset_reservation_status') THEN
    CREATE TYPE public.mfa_reset_reservation_status AS ENUM ('pending_delete', 'awaiting_reenrollment');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mfa_reset_reservations (
  operation_id uuid PRIMARY KEY,
  target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  status public.mfa_reset_reservation_status NOT NULL DEFAULT 'pending_delete',
  CONSTRAINT chk_mfa_reservation_expiry CHECK (expires_at > reserved_at)
);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_reservations_target ON public.mfa_reset_reservations(target_id);
CREATE INDEX IF NOT EXISTS idx_mfa_reset_reservations_status ON public.mfa_reset_reservations(status);

REVOKE ALL ON TABLE public.mfa_reset_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mfa_reset_reservations TO service_role;

-- 2. Create Step-Up Receipts table
CREATE TABLE IF NOT EXISTS public.step_up_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  action_class text NOT NULL CHECK (
    action_class IN ('owner_promotion', 'owner_demotion', 'owner_block', 'owner_archive', 'owner_terminate', 'mfa_reset')
  ),
  target_id uuid,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_receipt_expiry CHECK (expires_at > verified_at)
);

CREATE INDEX IF NOT EXISTS idx_step_up_receipts_lookup
ON public.step_up_receipts(actor_id, session_id, action_class, expires_at);

REVOKE ALL ON TABLE public.step_up_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.step_up_receipts TO service_role;

-- 3. Invariant Helpers: require_aal2() & require_recent_mfa()
CREATE OR REPLACE FUNCTION public.require_aal2()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_aal2() TO authenticated;

CREATE OR REPLACE FUNCTION public.require_recent_mfa()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_aal text := auth.jwt()->>'aal';
  v_amr jsonb := auth.jwt()->'amr';
  v_latest_ts bigint;
BEGIN
  IF (v_aal) IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required for recent MFA' USING ERRCODE = '42501';
  END IF;

  IF v_amr IS NULL THEN
    RAISE EXCEPTION 'Missing AMR claim' USING ERRCODE = '42501';
  END IF;

  SELECT max((elem->>'timestamp')::bigint) INTO v_latest_ts
  FROM jsonb_array_elements(v_amr) AS elem
  WHERE elem->>'method' = 'totp';

  IF v_latest_ts IS NULL THEN
    RAISE EXCEPTION 'No TOTP entry in AMR' USING ERRCODE = '42501';
  END IF;

  IF (EXTRACT(EPOCH FROM now())::bigint - v_latest_ts) > 300 THEN
    RAISE EXCEPTION 'TOTP verification older than 5 minutes' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_recent_mfa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_recent_mfa() TO authenticated;

-- 4. assert_owner_removal_quorum (accounting for active reservations and persistent recovery state)
CREATE OR REPLACE FUNCTION public.assert_owner_removal_quorum(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_cnt integer;
BEGIN
  SELECT count(*) INTO v_owner_cnt
  FROM public.profiles
  WHERE employment_status = 'active'
    AND is_blocked = false
    AND deleted = false
    AND role = 'owner'
    AND id <> p_target_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.mfa_reset_reservations r
      WHERE r.target_id = profiles.id
        AND (
          r.status = 'awaiting_reenrollment'
          OR (
            r.status = 'pending_delete'
            AND r.expires_at > now()
          )
        )
    );

  IF v_owner_cnt < 1 THEN
    RAISE EXCEPTION 'Action rejected: Organization must retain at least one active, unblocked Owner with verified MFA.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_owner_removal_quorum(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_owner_removal_quorum(uuid) TO service_role;

-- 5. Receipt Minting Function
CREATE OR REPLACE FUNCTION public.create_step_up_receipt(
  p_actor_id uuid,
  p_session_id uuid,
  p_action_class text,
  p_target_id uuid,
  p_verified_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt_id uuid;
  v_expires_at timestamptz := p_verified_at + interval '5 minutes';
BEGIN
  IF p_verified_at > now() + interval '10 seconds' OR p_verified_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid verification timestamp' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.step_up_receipts (
    actor_id, session_id, action_class, target_id, verified_at, expires_at
  ) VALUES (
    p_actor_id, p_session_id, p_action_class, p_target_id, p_verified_at, v_expires_at
  ) RETURNING id INTO v_receipt_id;

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_step_up_receipt(uuid, uuid, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_step_up_receipt(uuid, uuid, text, uuid, timestamptz) TO service_role;

-- 6. Owner Promotion RPC
CREATE OR REPLACE FUNCTION public.promote_workforce_to_owner(
  p_actor_id uuid,
  p_target_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  -- Caller check
  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id
    AND employment_status = 'active'
    AND is_blocked = false
    AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Caller must be an active, unblocked Owner' USING ERRCODE = '42501';
  END IF;

  -- Step-up validation
  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id
    AND session_id = p_session_id
    AND action_class = 'owner_promotion'
    AND (target_id IS NULL OR target_id = p_target_id)
    AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL THEN
      RAISE EXCEPTION 'Valid step-up verification required' USING ERRCODE = '42501';
    END IF;
    IF (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Step-up verification expired or invalid' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Target lock and check
  SELECT * INTO target_rec FROM public.profiles
  WHERE id = p_target_id
    AND employment_status = 'active'
    AND is_blocked = false
    AND deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not eligible for promotion' USING ERRCODE = '42501';
  END IF;

  IF target_rec.role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target user must be an active staff or admin' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET role = 'owner', updated_at = now()
  WHERE id = p_target_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'owner_promotion',
    'staff',
    p_target_id::text,
    jsonb_build_object(
      'actor_id', p_actor_id,
      'target_id', p_target_id,
      'previous_role', target_rec.role,
      'new_role', 'owner',
      'step_up_verified_at', p_step_up_verified_at,
      'mutation_at', now(),
      'session_id', p_session_id,
      'claim_sync_status', 'pending'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'promoted',
    'target_user_id', p_target_id,
    'role', 'owner'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_workforce_to_owner(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_workforce_to_owner(uuid, uuid, uuid, timestamptz) TO service_role;

-- 7. Owner Demotion RPC
CREATE OR REPLACE FUNCTION public.demote_owner(
  p_actor_id uuid,
  p_target_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id
    AND employment_status = 'active'
    AND is_blocked = false
    AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Caller must be an active, unblocked Owner' USING ERRCODE = '42501';
  END IF;

  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id
    AND session_id = p_session_id
    AND action_class = 'owner_demotion'
    AND (target_id IS NULL OR target_id = p_target_id)
    AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL THEN
      RAISE EXCEPTION 'Valid step-up verification required' USING ERRCODE = '42501';
    END IF;
    IF (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Step-up verification expired or invalid' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO target_rec FROM public.profiles
  WHERE id = p_target_id
    AND employment_status = 'active'
    AND is_blocked = false
    AND deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF target_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Target user is not an Owner' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_owner_removal_quorum(p_target_id);

  UPDATE public.profiles
  SET role = 'admin', updated_at = now()
  WHERE id = p_target_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'owner_demotion',
    'staff',
    p_target_id::text,
    jsonb_build_object(
      'actor_id', p_actor_id,
      'target_id', p_target_id,
      'previous_role', 'owner',
      'new_role', 'admin',
      'step_up_verified_at', p_step_up_verified_at,
      'mutation_at', now(),
      'session_id', p_session_id,
      'claim_sync_status', 'pending'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'demoted',
    'target_user_id', p_target_id,
    'role', 'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.demote_owner(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demote_owner(uuid, uuid, uuid, timestamptz) TO service_role;

-- 8. Owner Block RPC
CREATE OR REPLACE FUNCTION public.block_owner(
  p_actor_id uuid,
  p_target_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id AND employment_status = 'active' AND is_blocked = false AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Caller must be an active, unblocked Owner' USING ERRCODE = '42501';
  END IF;

  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id AND session_id = p_session_id AND action_class = 'owner_block'
    AND (target_id IS NULL OR target_id = p_target_id) AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL OR (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Valid step-up verification required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO target_rec FROM public.profiles
  WHERE id = p_target_id AND deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found' USING ERRCODE = '42501'; END IF;
  IF target_rec.role <> 'owner' THEN RAISE EXCEPTION 'Target is not an Owner' USING ERRCODE = '42501'; END IF;
  IF target_rec.is_blocked IS TRUE THEN
    RETURN jsonb_build_object('ok', true, 'status', 'no_change', 'target_user_id', p_target_id);
  END IF;

  PERFORM public.assert_owner_removal_quorum(p_target_id);

  UPDATE public.profiles SET is_blocked = true, updated_at = now() WHERE id = p_target_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'owner_blocked', 'staff', p_target_id::text,
    jsonb_build_object(
      'actor_id', p_actor_id, 'target_id', p_target_id,
      'step_up_verified_at', p_step_up_verified_at, 'mutation_at', now(), 'session_id', p_session_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'blocked', 'target_user_id', p_target_id);
END;
$$;

REVOKE ALL ON FUNCTION public.block_owner(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_owner(uuid, uuid, uuid, timestamptz) TO service_role;

-- 9. Owner Archive RPC
CREATE OR REPLACE FUNCTION public.archive_owner(
  p_actor_id uuid,
  p_target_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id AND employment_status = 'active' AND is_blocked = false AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Caller must be an active, unblocked Owner' USING ERRCODE = '42501';
  END IF;

  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id AND session_id = p_session_id AND action_class = 'owner_archive'
    AND (target_id IS NULL OR target_id = p_target_id) AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL OR (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Valid step-up verification required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO target_rec FROM public.profiles WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found' USING ERRCODE = '42501'; END IF;
  IF target_rec.role <> 'owner' THEN RAISE EXCEPTION 'Target is not an Owner' USING ERRCODE = '42501'; END IF;
  IF target_rec.deleted IS TRUE THEN
    RETURN jsonb_build_object('ok', true, 'status', 'no_change', 'target_user_id', p_target_id);
  END IF;

  PERFORM public.assert_owner_removal_quorum(p_target_id);

  UPDATE public.profiles SET deleted = true, updated_at = now() WHERE id = p_target_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'owner_archived', 'staff', p_target_id::text,
    jsonb_build_object(
      'actor_id', p_actor_id, 'target_id', p_target_id,
      'step_up_verified_at', p_step_up_verified_at, 'mutation_at', now(), 'session_id', p_session_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'archived', 'target_user_id', p_target_id);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_owner(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_owner(uuid, uuid, uuid, timestamptz) TO service_role;

-- 10. Owner Terminate RPC
CREATE OR REPLACE FUNCTION public.terminate_owner(
  p_actor_id uuid,
  p_target_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id AND employment_status = 'active' AND is_blocked = false AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Caller must be an active, unblocked Owner' USING ERRCODE = '42501';
  END IF;

  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id AND session_id = p_session_id AND action_class = 'owner_terminate'
    AND (target_id IS NULL OR target_id = p_target_id) AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL OR (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Valid step-up verification required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO target_rec FROM public.profiles WHERE id = p_target_id AND deleted = false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found' USING ERRCODE = '42501'; END IF;
  IF target_rec.role <> 'owner' THEN RAISE EXCEPTION 'Target is not an Owner' USING ERRCODE = '42501'; END IF;
  IF target_rec.employment_status = 'terminated' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'no_change', 'target_user_id', p_target_id);
  END IF;

  PERFORM public.assert_owner_removal_quorum(p_target_id);

  UPDATE public.profiles SET employment_status = 'terminated', updated_at = now() WHERE id = p_target_id;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'owner_terminated', 'staff', p_target_id::text,
    jsonb_build_object(
      'actor_id', p_actor_id, 'target_id', p_target_id,
      'step_up_verified_at', p_step_up_verified_at, 'mutation_at', now(), 'session_id', p_session_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'terminated', 'target_user_id', p_target_id);
END;
$$;

REVOKE ALL ON FUNCTION public.terminate_owner(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminate_owner(uuid, uuid, uuid, timestamptz) TO service_role;

-- 11. MFA Reset Workflow Functions
CREATE OR REPLACE FUNCTION public.begin_workforce_mfa_reset(
  p_actor_id uuid,
  p_target_id uuid,
  p_reason text,
  p_operation_id uuid,
  p_session_id uuid,
  p_step_up_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_rec record;
  target_rec record;
  v_receipt_verified_at timestamptz;
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason cannot be empty' USING ERRCODE = '42501';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'Self-reset prohibited' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT * INTO actor_rec FROM public.profiles
  WHERE id = p_actor_id AND employment_status = 'active' AND is_blocked = false AND deleted = false;
  IF NOT FOUND OR actor_rec.role <> 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Only active Owner may reset MFA' USING ERRCODE = '42501';
  END IF;

  -- Step-up validation
  SELECT verified_at INTO v_receipt_verified_at
  FROM public.step_up_receipts
  WHERE actor_id = p_actor_id AND session_id = p_session_id AND action_class = 'mfa_reset'
    AND (target_id IS NULL OR target_id = p_target_id) AND now() < expires_at;

  IF FOUND THEN
    p_step_up_verified_at := v_receipt_verified_at;
  ELSE
    IF p_step_up_verified_at IS NULL OR (now() - p_step_up_verified_at) > interval '5 minutes' OR p_step_up_verified_at > now() + interval '10 seconds' THEN
      RAISE EXCEPTION 'Valid step-up verification required for MFA reset' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO target_rec FROM public.profiles
  WHERE id = p_target_id AND employment_status = 'active' AND is_blocked = false AND deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF target_rec.role = 'owner' THEN
    PERFORM public.assert_owner_removal_quorum(p_target_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mfa_reset_reservations r
    WHERE r.target_id = p_target_id AND (r.status = 'awaiting_reenrollment' OR (r.status = 'pending_delete' AND r.expires_at > now()))
  ) THEN
    RAISE EXCEPTION 'Another MFA reset is already pending for this user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.mfa_reset_reservations (
    operation_id, target_id, expires_at, status
  ) VALUES (
    p_operation_id, p_target_id, now() + interval '30 minutes', 'pending_delete'
  );

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    p_actor_id,
    COALESCE(NULLIF(trim(concat_ws(' ', actor_rec.first_name, actor_rec.last_name)), ''), actor_rec.email),
    'mfa_reset_requested',
    'staff',
    p_target_id::text,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'actor_id', p_actor_id,
      'target_id', p_target_id,
      'target_role', target_rec.role,
      'reason', trim(p_reason),
      'session_id', p_session_id,
      'step_up_verified_at', p_step_up_verified_at,
      'requested_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'target_id', p_target_id,
    'target_role', target_rec.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_workforce_mfa_reset(uuid, uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_workforce_mfa_reset(uuid, uuid, text, uuid, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_mfa_reset_to_awaiting(
  p_operation_id uuid,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.mfa_reset_reservations
  SET status = 'awaiting_reenrollment'
  WHERE operation_id = p_operation_id
    AND target_id = p_target_id
    AND status = 'pending_delete';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending reservation not found for operation %', p_operation_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.logs (action, target_type, target_id, details)
  VALUES (
    'mfa_reset_awaiting_reenrollment',
    'staff',
    p_target_id::text,
    jsonb_build_object('operation_id', p_operation_id, 'target_id', p_target_id, 'transitioned_at', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_mfa_reset_to_awaiting(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_mfa_reset_to_awaiting(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_mfa_reset_reservation(
  p_operation_id uuid,
  p_target_id uuid,
  p_action text,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mfa_reset_reservations
  WHERE operation_id = p_operation_id AND target_id = p_target_id;

  INSERT INTO public.logs (action, target_type, target_id, details)
  VALUES (
    p_action,
    'staff',
    p_target_id::text,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'target_id', p_target_id,
      'cleared_at', now(),
      'error', p_error
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clear_mfa_reset_reservation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_mfa_reset_reservation(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_mfa_reset(
  p_operation_id uuid,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.mfa_reset_reservations
  WHERE operation_id = p_operation_id
    AND target_id = p_target_id
    AND status = 'awaiting_reenrollment';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Awaiting re-enrollment reservation not found for operation %', p_operation_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.logs (action, target_type, target_id, details)
  VALUES (
    'mfa_reset_reenrollment_completed',
    'staff',
    p_target_id::text,
    jsonb_build_object('operation_id', p_operation_id, 'target_id', p_target_id, 'completed_at', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_mfa_reset(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mfa_reset(uuid, uuid) TO service_role;

-- 12. Baseline AAL2 Enforcement for Phase-1 Workforce RPCs
CREATE OR REPLACE FUNCTION public.update_staff_status_v2(
  target_user_id uuid,
  employment_status text,
  is_blocked boolean,
  change_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_employment_status text := employment_status;
  v_new_is_blocked boolean := is_blocked;
  v_target record;
BEGIN
  -- Direct baseline AAL2 enforcement
  PERFORM public.require_aal2();

  IF NOT public.can_manage_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id cannot be null';
  END IF;

  IF v_new_employment_status IS NULL OR v_new_employment_status NOT IN ('active', 'on_leave', 'resigned', 'terminated') THEN
    RAISE EXCEPTION 'Invalid employment_status value';
  END IF;

  IF v_new_is_blocked IS NULL THEN
    RAISE EXCEPTION 'is_blocked cannot be null';
  END IF;

  IF change_note IS NULL OR trim(change_note) = '' OR length(trim(change_note)) > 500 THEN
    RAISE EXCEPTION 'change_note must be between 1 and 500 characters';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF v_target.role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target user is not a staff member or administrator';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot modify your own status';
  END IF;

  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot modify owner account status';
  END IF;

  IF v_target.deleted IS NOT FALSE THEN
    RAISE EXCEPTION 'Cannot update status of an archived staff member';
  END IF;

  IF v_target.employment_status = 'resigned' AND v_new_employment_status <> 'resigned' THEN
    RAISE EXCEPTION 'Cannot change employment status of a resigned staff member';
  END IF;

  IF v_target.employment_status = 'terminated' AND v_new_employment_status <> 'terminated' THEN
    RAISE EXCEPTION 'Cannot change employment status of a terminated staff member';
  END IF;

  IF v_target.employment_status = v_new_employment_status AND v_target.is_blocked = v_new_is_blocked THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'no_change',
      'target_user_id', target_user_id,
      'employment_status', v_new_employment_status,
      'is_blocked', v_new_is_blocked
    );
  END IF;

  IF (v_target.role IN ('admin', 'owner') AND v_target.deleted = false AND v_target.is_blocked = false AND v_target.employment_status = 'active')
     AND (v_new_employment_status <> 'active' OR v_new_is_blocked = true) THEN
    PERFORM public.assert_privileged_account_quorum(target_user_id);
  END IF;

  PERFORM set_config('app.current_change_note', trim(change_note), true);

  UPDATE public.profiles AS p
  SET employment_status = v_new_employment_status,
      is_blocked = v_new_is_blocked,
      updated_at = now()
  WHERE p.id = target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'target_user_id', target_user_id,
    'previous_status', v_target.employment_status,
    'new_status', v_new_employment_status,
    'previous_blocked', v_target.is_blocked,
    'new_blocked', v_new_is_blocked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_status_v2(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_status_v2(uuid, text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_staff_role_v2(
  target_user_id uuid,
  new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
  v_actor_name text;
BEGIN
  -- Direct baseline AAL2 enforcement
  PERFORM public.require_aal2();

  IF NOT public.can_manage_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id cannot be null';
  END IF;

  IF new_role = 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Owner role promotion is restricted to dedicated Owner promotion procedure.'
      USING ERRCODE = '42501';
  END IF;

  IF new_role IS NULL OR new_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Invalid role specified';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF v_target.role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target user is not a staff member or administrator';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot modify owner account status';
  END IF;

  IF v_target.deleted IS NOT FALSE THEN
    RAISE EXCEPTION 'Cannot update role of an archived staff member';
  END IF;

  IF v_target.role = new_role THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'no_change',
      'target_user_id', target_user_id,
      'role', new_role
    );
  END IF;

  IF (v_target.role = 'admin' AND v_target.deleted = false AND v_target.is_blocked = false AND v_target.employment_status = 'active')
     AND new_role = 'staff' THEN
    PERFORM public.assert_privileged_account_quorum(target_user_id);
  END IF;

  UPDATE public.profiles AS p
  SET role = new_role,
      updated_at = now()
  WHERE p.id = target_user_id;

  SELECT COALESCE( NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff' )
  INTO v_actor_name
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    v_actor_name,
    'staff_role_updated',
    'staff',
    target_user_id::text,
    jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', new_role,
      'claim_sync_status', 'pending'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'target_user_id', target_user_id,
    'previous_role', v_target.role,
    'new_role', new_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_role_v2(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_role_v2(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_staff_archive_state(
  target_user_id uuid,
  archived boolean,
  change_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
  v_actor_name text;
BEGIN
  -- Direct baseline AAL2 enforcement
  PERFORM public.require_aal2();

  IF NOT public.can_manage_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id cannot be null';
  END IF;

  IF archived IS NULL THEN
    RAISE EXCEPTION 'archived cannot be null';
  END IF;

  IF change_note IS NULL OR trim(change_note) = '' OR length(trim(change_note)) > 500 THEN
    RAISE EXCEPTION 'change_note must be between 1 and 500 characters';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF v_target.role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target user is not a staff member or administrator';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot archive your own account';
  END IF;

  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot archive owner account';
  END IF;

  IF (v_target.deleted IS TRUE AND archived IS TRUE) OR (v_target.deleted IS FALSE AND archived IS FALSE) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'no_change',
      'state', CASE WHEN archived THEN 'archived' ELSE 'restored' END,
      'target_user_id', target_user_id
    );
  END IF;

  IF (v_target.role IN ('admin', 'owner') AND v_target.deleted = false AND v_target.is_blocked = false AND v_target.employment_status = 'active')
     AND archived IS TRUE THEN
    PERFORM public.assert_privileged_account_quorum(target_user_id);
  END IF;

  UPDATE public.profiles AS p
  SET deleted = archived,
      updated_at = now()
  WHERE p.id = target_user_id;

  SELECT COALESCE( NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), 'Staff' )
  INTO v_actor_name
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    v_actor_name,
    CASE WHEN archived THEN 'staff_archived' ELSE 'staff_restored' END,
    'staff',
    target_user_id::text,
    jsonb_build_object(
      'archived', archived,
      'previous_deleted', v_target.deleted,
      'new_deleted', archived,
      'note', trim(change_note)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN archived THEN 'archived' ELSE 'restored' END,
    'state', CASE WHEN archived THEN 'archived' ELSE 'restored' END,
    'target_user_id', target_user_id,
    'previous_deleted', v_target.deleted,
    'new_deleted', archived
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_archive_state(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_archive_state(uuid, boolean, text) TO authenticated;
