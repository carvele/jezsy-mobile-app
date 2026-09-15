-- Harden workforce IAM invariants, staff-only activation, and profile write boundaries
-- Migration: 20260915120000_harden_workforce_iam_invariants.sql

-- 1. Schema nullability and delivery tracking columns on public.profiles
ALTER TABLE public.profiles ALTER COLUMN employment_status DROP NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employment_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_status_check
  CHECK (employment_status IS NULL OR employment_status IN ('invited', 'active', 'on_leave', 'resigned', 'terminated'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_delivery_status text NULL
  CHECK (invite_delivery_status IS NULL OR invite_delivery_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS invited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_staff_work_email_unique
ON public.profiles (lower(trim(email)))
WHERE role IN ('staff', 'admin', 'owner') AND deleted = false;

-- 2. Targeted write-privilege revocation on public.profiles (preserving SELECT)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.profiles
FROM authenticated, anon, public;

GRANT UPDATE (
  first_name, last_name, username, phone, gender, date_of_birth,
  address_line, barangay, city, province, zip_code,
  fit_preference, is_wardrobe_shared, wardrobe_privacy,
  wishlist_privacy, outfit_privacy, profile_visibility,
  expo_push_token, updated_at
) ON TABLE public.profiles TO authenticated;

GRANT INSERT (
  id, email, updated_at,
  first_name, last_name, username, phone, gender, date_of_birth,
  address_line, barangay, city, province, zip_code,
  fit_preference, is_wardrobe_shared, wardrobe_privacy,
  wishlist_privacy, outfit_privacy, profile_visibility,
  expo_push_token
) ON TABLE public.profiles TO authenticated;

-- 3. Strict identity binding and customer default trigger on direct client INSERT
CREATE OR REPLACE FUNCTION public.enforce_profile_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_jwt_email text;
BEGIN
  IF current_user IN ('postgres', 'service_role') OR
     (current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated session required to create a profile'
      USING ERRCODE = '42501';
  END IF;

  NEW.id := auth.uid();

  v_jwt_email := current_setting('request.jwt.claims', true)::jsonb ->> 'email';
  IF v_jwt_email IS NULL OR trim(v_jwt_email) = '' THEN
    RAISE EXCEPTION 'Cannot create profile without verified email claim in auth token'
      USING ERRCODE = '23502';
  END IF;
  NEW.email := lower(trim(v_jwt_email));

  NEW.role := 'customer';
  NEW.employment_status := NULL;
  NEW.is_blocked := false;
  NEW.deleted := false;
  NEW.invite_delivery_status := NULL;
  NEW.invited_at := NULL;
  NEW.last_invited_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_insert_defaults ON public.profiles;
CREATE TRIGGER trg_enforce_profile_insert_defaults
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_insert_defaults();

-- 4. Centralized privileged account quorum helper
CREATE OR REPLACE FUNCTION public.assert_privileged_account_quorum(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(7421, 1);

  SELECT count(*) INTO v_active_count
  FROM public.profiles AS p
  WHERE p.role IN ('admin', 'owner')
    AND p.deleted = false
    AND p.is_blocked = false
    AND p.employment_status = 'active'
    AND p.id <> target_user_id;

  IF v_active_count < 1 THEN
    RAISE EXCEPTION 'Action rejected: Organization must retain at least one active, unblocked privileged account (Admin/Owner).'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_privileged_account_quorum(uuid) FROM PUBLIC, anon, authenticated;

-- 5. Transactional staff-only activation RPC
CREATE OR REPLACE FUNCTION public.activate_staff_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_user_email text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No authenticated session' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.deleted IS TRUE OR v_profile.is_blocked IS TRUE THEN
    RAISE EXCEPTION 'Account is blocked or archived' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role <> 'staff' THEN
    RAISE EXCEPTION 'Account role cannot be activated through Phase 1 staff onboarding'
      USING ERRCODE = '42501';
  END IF;

  IF v_profile.employment_status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_active', 'role', v_profile.role);
  END IF;

  IF v_profile.employment_status <> 'invited' THEN
    RAISE EXCEPTION 'Account cannot be activated from status %', v_profile.employment_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET employment_status = 'active',
      updated_at = now()
  WHERE id = v_uid;

  INSERT INTO public.staff_status_history (
    staff_id, change_type, previous_value, new_value,
    note, effective_date, changed_by
  ) VALUES (
    v_uid, 'employment_status', 'invited', 'active',
    'Staff account activated via password setup',
    CURRENT_DATE, v_uid
  );

  v_user_email := COALESCE(v_profile.email, 'unknown');
  v_actor_name := COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), v_user_email);

  INSERT INTO public.logs (
    user_id, user_name, action, target_type, target_id, details
  ) VALUES (
    v_uid,
    v_actor_name,
    'staff_account_activated',
    'staff',
    v_uid::text,
    jsonb_build_object('role', v_profile.role, 'email', v_user_email)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'activated',
    'role', v_profile.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_staff_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_staff_account() TO authenticated;

-- 5b. Update legacy check_profile_updates trigger function to permit legitimate self-activation
CREATE OR REPLACE FUNCTION public.check_profile_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  performer_role text;
BEGIN
  IF (
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.employment_status IS DISTINCT FROM OLD.employment_status OR
    NEW.is_blocked IS DISTINCT FROM OLD.is_blocked OR
    NEW.deleted IS DISTINCT FROM OLD.deleted
  ) THEN
    IF auth.uid() IS NOT NULL THEN
      IF auth.uid() = OLD.id THEN
        -- Allow the legitimate self-activation of an invited staff account via activate_staff_account()
        IF OLD.employment_status = 'invited'
           AND NEW.employment_status = 'active'
           AND OLD.role = 'staff'
           AND NEW.role = 'staff'
           AND NEW.is_blocked IS NOT DISTINCT FROM OLD.is_blocked
           AND NEW.deleted IS NOT DISTINCT FROM OLD.deleted THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'You cannot modify your own role, employment status, block status, or deletion status.';
      END IF;

      SELECT role INTO performer_role
      FROM public.profiles
      WHERE id = auth.uid() AND deleted = false;

      IF performer_role IS NULL OR performer_role NOT IN ('admin', 'owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, block status, or deletion status.';
      END IF;

      IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'The Owner role cannot be assigned through the application.';
      END IF;

      IF OLD.role = 'owner' THEN
        RAISE EXCEPTION 'The Owner account cannot be modified.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Hardened status management RPC
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

-- 7. Hardened role management RPC (prohibiting Owner promotion in Phase 1)
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
  IF NOT public.can_manage_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id cannot be null';
  END IF;

  IF new_role = 'owner' THEN
    RAISE EXCEPTION 'Action rejected: Owner role promotion is restricted until Phase 2 MFA and step-up authentication are deployed.'
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

-- 8. Hardened staff archive RPC
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
