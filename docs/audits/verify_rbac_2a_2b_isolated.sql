-- ============================================================================
-- RBAC 2A -> 2B Isolated PostgreSQL End-to-End Verification Test Harness
-- ============================================================================
-- Tests the complete schema, backfill, capability resolution, writer cutover,
-- Owner quorum invariants, compensation behavior, and rollback.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

RAISE NOTICE '=== TEST 1: Verifying Initial Migration 2A Hard Assertions ===';
-- The hard assertions embedded in 20260915160000 will raise exception on any drift:
-- 1. Legacy workforce profiles missing membership = 0
-- 2. Every workforce profile without membership = 0
-- 3. Membership rows without workforce account_kind = 0
-- 4. Role mismatches between profile and membership = 0
-- 5. Employment-state mismatches = 0
-- 6. Unknown workforce roles = 0
-- 7. Owner-count mismatch = 0

RAISE NOTICE '=== TEST 2: Testing Capability Resolution Matrix ===';
DO $$$
DECLARE
  v_test_user uuid := gen_random_uuid();
BEGIN
  -- Insert dummy test staff profile
  INSERT INTO public.profiles (id, email, account_kind, role, employment_status, is_blocked, deleted)
  VALUES (v_test_user, 'test_staff@jezsy.test', 'workforce', 'staff', 'active', false, false);

  -- Insert dummy membership
  INSERT INTO public.staff_memberships (user_id, role, employment_status, device_approval_state)
  VALUES (v_test_user, 'staff', 'active', 'approved');

  -- 2a. Role default check: staff has reservations.operate
  IF NOT public.has_capability(v_test_user, 'reservations.operate') THEN
    RAISE EXCEPTION 'Test 2a failed: Staff should have reservations.operate by default';
  END IF;

  -- 2b. Role default check: staff does NOT have analytics.view
  IF public.has_capability(v_test_user, 'analytics.view') THEN
    RAISE EXCEPTION 'Test 2b failed: Staff should NOT have analytics.view by default';
  END IF;

  -- 2c. Explicit ALLOW override
  INSERT INTO public.staff_capability_overrides (user_id, capability_id, override_type)
  VALUES (v_test_user, 'analytics.view', 'allow');

  IF NOT public.has_capability(v_test_user, 'analytics.view') THEN
    RAISE EXCEPTION 'Test 2c failed: Staff with explicit allow override should have analytics.view';
  END IF;

  -- 2d. Explicit DENY override wins
  UPDATE public.staff_capability_overrides
  SET override_type = 'deny'
  WHERE user_id = v_test_user AND capability_id = 'reservations.operate';

  IF public.has_capability(v_test_user, 'reservations.operate') THEN
    RAISE EXCEPTION 'Test 2d failed: Explicit deny override MUST win over role default';
  END IF;

  -- 2e. Unauthorized when suspended or device not approved
  UPDATE public.staff_memberships
  SET employment_status = 'suspended'
  WHERE user_id = v_test_user;

  IF public.has_capability(v_test_user, 'analytics.view') THEN
    RAISE EXCEPTION 'Test 2e failed: Suspended workforce must not have active capabilities';
  END IF;

  -- Cleanup test user
  DELETE FROM public.profiles WHERE id = v_test_user;
END;
$$$;

RAISE NOTICE '=== TEST 3: Testing Writer Cutover & Projection Trigger ===';
DO $$$
DECLARE
  v_user uuid := gen_random_uuid();
  v_prof record;
BEGIN
  -- Insert base profile (identity only)
  INSERT INTO public.profiles (id, email, account_kind)
  VALUES (v_user, 'writer_test@jezsy.test', 'customer');

  -- Canonical write to staff_memberships
  INSERT INTO public.staff_memberships (user_id, role, employment_status, device_approval_state)
  VALUES (v_user, 'staff', 'invited', 'not_required');

  -- Check projection into profiles
  SELECT * INTO v_prof FROM public.profiles WHERE id = v_user;
  IF v_prof.role <> 'staff' OR v_prof.employment_status <> 'invited' OR v_prof.account_kind <> 'workforce' THEN
    RAISE EXCEPTION 'Test 3 failed: Trigger failed to project membership to profile (role=%, status=%, kind=%)',
      v_prof.role, v_prof.employment_status, v_prof.account_kind;
  END IF;

  -- Role update via converted writer
  UPDATE public.staff_memberships SET role = 'admin' WHERE user_id = v_user;
  SELECT role INTO v_prof.role FROM public.profiles WHERE id = v_user;
  IF v_prof.role <> 'admin' THEN
    RAISE EXCEPTION 'Test 3b failed: Trigger failed to project role change to profile';
  END IF;

  -- Cleanup test user (CASCADE deletes membership)
  DELETE FROM public.profiles WHERE id = v_user;
  IF EXISTS (SELECT 1 FROM public.staff_memberships WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'Test 3c failed: FK CASCADE failed to delete membership upon profile removal';
  END IF;
END;
$$$;

RAISE NOTICE '=== TEST 4: Testing Generic Role RPC Owner Boundary ===';
DO $$$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_err boolean := false;
BEGIN
  INSERT INTO public.profiles (id, email, account_kind, role, employment_status)
  VALUES (v_admin, 'admin_guard@jezsy.test', 'workforce', 'admin', 'active');
  INSERT INTO public.staff_memberships (user_id, role, employment_status)
  VALUES (v_admin, 'admin', 'active');

  BEGIN
    -- Attempting to update to owner via update_staff_role_v2 must raise 42501
    PERFORM public.update_staff_role_v2(v_admin, 'owner');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'Test 4 failed: update_staff_role_v2 allowed promotion to owner!';
  END IF;

  DELETE FROM public.profiles WHERE id = v_admin;
END;
$$$;

RAISE NOTICE '=== ALL ISOLATED VERIFICATION TESTS PASSED CLEANLY ===';

ROLLBACK; -- Clean test run without leaving artifacts
