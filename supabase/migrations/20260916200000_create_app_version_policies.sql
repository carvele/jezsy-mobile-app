-- Minimum-Supported-Mobile-Version Enforcement System
-- Migration: 20260916200000_create_app_version_policies.sql

BEGIN;

-- 1. Create app_version_policies table
CREATE TABLE IF NOT EXISTS public.app_version_policies (
  platform TEXT PRIMARY KEY CHECK (platform IN ('ios', 'android', 'web')),
  min_version TEXT NOT NULL CHECK (min_version ~ '^\d+\.\d+\.\d+$'),
  min_build_number INTEGER NOT NULL DEFAULT 0 CHECK (min_build_number >= 0),
  latest_version TEXT NOT NULL CHECK (latest_version ~ '^\d+\.\d+\.\d+$'),
  latest_build_number INTEGER NOT NULL DEFAULT 0 CHECK (latest_build_number >= 0),
  emergency_bypass_enabled BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL DEFAULT 'Update Required',
  message TEXT NOT NULL DEFAULT 'A new version of JezSy is required to continue. Please update to access our latest collections.',
  store_url TEXT NOT NULL,
  store_fallback_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by UUID REFERENCES auth.users(id)
);

-- 2. Create app_version_policy_audit table
CREATE TABLE IF NOT EXISTS public.app_version_policy_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  action TEXT NOT NULL,
  old_policy JSONB,
  new_policy JSONB,
  operator_id UUID REFERENCES auth.users(id),
  operator_email TEXT,
  confirmation_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_app_version_policy_audit_platform ON public.app_version_policy_audit(platform);
CREATE INDEX IF NOT EXISTS idx_app_version_policy_audit_created ON public.app_version_policy_audit(created_at DESC);

-- 3. Seed baseline initial policies for iOS and Android
INSERT INTO public.app_version_policies (
  platform,
  min_version,
  min_build_number,
  latest_version,
  latest_build_number,
  emergency_bypass_enabled,
  title,
  message,
  store_url,
  store_fallback_url
) VALUES 
(
  'android',
  '1.0.0',
  1,
  '1.0.0',
  1,
  false,
  'Update Required',
  'A new version of JezSy is required to continue. Please update from Google Play to access our latest collections and fitting room features.',
  'market://details?id=com.jezsy.mobileapp',
  'https://play.google.com/store/apps/details?id=com.jezsy.mobileapp'
),
(
  'ios',
  '1.0.0',
  1,
  '1.0.0',
  1,
  false,
  'Update Required',
  'A new version of JezSy is required to continue. Please update from the App Store to access our latest collections and fitting room features.',
  'itms-apps://itunes.apple.com/app/id6742354921',
  'https://apps.apple.com/app/jezsy/id6742354921'
)
ON CONFLICT (platform) DO NOTHING;

-- 4. Secure RLS & Table Permissions
ALTER TABLE public.app_version_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_version_policy_audit ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from public/anon/authenticated on tables
REVOKE ALL ON TABLE public.app_version_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.app_version_policy_audit FROM PUBLIC, anon, authenticated;

-- Allow service_role and internal functions full access
GRANT ALL ON TABLE public.app_version_policies TO service_role;
GRANT ALL ON TABLE public.app_version_policy_audit TO service_role;

-- 5. Public RPC: get_app_version_policy
CREATE OR REPLACE FUNCTION public.get_app_version_policy(p_platform TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy RECORD;
BEGIN
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid platform parameter'
    );
  END IF;

  SELECT 
    min_version,
    min_build_number,
    latest_version,
    latest_build_number,
    emergency_bypass_enabled,
    title,
    message,
    store_url,
    store_fallback_url
  INTO v_policy
  FROM public.app_version_policies
  WHERE platform = p_platform;

  IF NOT FOUND THEN
    -- Safe fallback baseline if row is missing
    RETURN jsonb_build_object(
      'success', true,
      'platform', p_platform,
      'min_version', '1.0.0',
      'min_build_number', 0,
      'latest_version', '1.0.0',
      'latest_build_number', 0,
      'emergency_bypass_enabled', true,
      'title', 'Update Required',
      'message', 'A new version of JezSy is available.',
      'store_url', '',
      'store_fallback_url', 'https://jezsy.com'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'platform', p_platform,
    'min_version', v_policy.min_version,
    'min_build_number', v_policy.min_build_number,
    'latest_version', v_policy.latest_version,
    'latest_build_number', v_policy.latest_build_number,
    'emergency_bypass_enabled', v_policy.emergency_bypass_enabled,
    'title', v_policy.title,
    'message', v_policy.message,
    'store_url', v_policy.store_url,
    'store_fallback_url', v_policy.store_fallback_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_app_version_policy(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_version_policy(TEXT) TO anon, authenticated, service_role;

-- 6. Privileged RPC: update_app_version_policy
CREATE OR REPLACE FUNCTION public.update_app_version_policy(
  p_platform TEXT,
  p_policy JSONB,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_policy RECORD;
  v_min_version TEXT;
  v_min_build INTEGER;
  v_latest_version TEXT;
  v_latest_build INTEGER;
  v_bypass BOOLEAN;
  v_title TEXT;
  v_message TEXT;
  v_store_url TEXT;
  v_store_fallback_url TEXT;
  v_operator_id UUID;
  v_operator_email TEXT;
BEGIN
  -- 1. Security Check: Operator must be staff or admin
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Access denied: staff or admin privileges required';
  END IF;

  v_operator_id := auth.uid();
  SELECT email INTO v_operator_email FROM auth.users WHERE id = v_operator_id;

  -- 2. Validate Platform
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform;
  END IF;

  -- 3. Extract & Validate Fields
  v_min_version := TRIM(p_policy->>'min_version');
  v_min_build := COALESCE((p_policy->>'min_build_number')::integer, 0);
  v_latest_version := TRIM(p_policy->>'latest_version');
  v_latest_build := COALESCE((p_policy->>'latest_build_number')::integer, 0);
  v_bypass := COALESCE((p_policy->>'emergency_bypass_enabled')::boolean, false);
  v_title := COALESCE(NULLIF(TRIM(p_policy->>'title'), ''), 'Update Required');
  v_message := COALESCE(NULLIF(TRIM(p_policy->>'message'), ''), 'A new version of JezSy is required to continue.');
  v_store_url := TRIM(p_policy->>'store_url');
  v_store_fallback_url := TRIM(p_policy->>'store_fallback_url');

  IF v_min_version IS NULL OR v_min_version !~ '^\d+\.\d+\.\d+$' THEN
    RAISE EXCEPTION 'Invalid min_version format (must be strict MAJOR.MINOR.PATCH): %', v_min_version;
  END IF;

  IF v_latest_version IS NULL OR v_latest_version !~ '^\d+\.\d+\.\d+$' THEN
    RAISE EXCEPTION 'Invalid latest_version format (must be strict MAJOR.MINOR.PATCH): %', v_latest_version;
  END IF;

  IF v_min_build < 0 OR v_latest_build < 0 THEN
    RAISE EXCEPTION 'Build numbers must be non-negative integers';
  END IF;

  IF v_store_url IS NULL OR v_store_url = '' THEN
    RAISE EXCEPTION 'store_url is required';
  END IF;

  IF v_store_fallback_url IS NULL OR v_store_fallback_url = '' THEN
    RAISE EXCEPTION 'store_fallback_url is required';
  END IF;

  -- 4. Fetch existing policy for audit diff
  SELECT * INTO v_old_policy
  FROM public.app_version_policies
  WHERE platform = p_platform;

  -- 5. Atomically update or insert policy
  INSERT INTO public.app_version_policies (
    platform,
    min_version,
    min_build_number,
    latest_version,
    latest_build_number,
    emergency_bypass_enabled,
    title,
    message,
    store_url,
    store_fallback_url,
    updated_at,
    updated_by
  ) VALUES (
    p_platform,
    v_min_version,
    v_min_build,
    v_latest_version,
    v_latest_build,
    v_bypass,
    v_title,
    v_message,
    v_store_url,
    v_store_fallback_url,
    timezone('utc'::text, now()),
    v_operator_id
  )
  ON CONFLICT (platform) DO UPDATE SET
    min_version = EXCLUDED.min_version,
    min_build_number = EXCLUDED.min_build_number,
    latest_version = EXCLUDED.latest_version,
    latest_build_number = EXCLUDED.latest_build_number,
    emergency_bypass_enabled = EXCLUDED.emergency_bypass_enabled,
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    store_url = EXCLUDED.store_url,
    store_fallback_url = EXCLUDED.store_fallback_url,
    updated_at = timezone('utc'::text, now()),
    updated_by = v_operator_id;

  -- 6. Insert audit record
  INSERT INTO public.app_version_policy_audit (
    platform,
    action,
    old_policy,
    new_policy,
    operator_id,
    operator_email,
    confirmation_text
  ) VALUES (
    p_platform,
    'UPDATE_POLICY',
    to_jsonb(v_old_policy),
    jsonb_build_object(
      'min_version', v_min_version,
      'min_build_number', v_min_build,
      'latest_version', v_latest_version,
      'latest_build_number', v_latest_build,
      'emergency_bypass_enabled', v_bypass,
      'title', v_title,
      'message', v_message,
      'store_url', v_store_url,
      'store_fallback_url', v_store_fallback_url
    ),
    v_operator_id,
    v_operator_email,
    p_confirmation
  );

  RETURN jsonb_build_object(
    'success', true,
    'platform', p_platform,
    'min_version', v_min_version,
    'latest_version', v_latest_version,
    'emergency_bypass_enabled', v_bypass
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_app_version_policy(TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_app_version_policy(TEXT, JSONB, TEXT) TO authenticated, service_role;

-- 7. Privileged RPC: set_global_version_enforcement_bypass
CREATE OR REPLACE FUNCTION public.set_global_version_enforcement_bypass(
  p_enabled BOOLEAN,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator_id UUID;
  v_operator_email TEXT;
  v_affected_rows INTEGER := 0;
BEGIN
  -- 1. Security Check
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Access denied: staff or admin privileges required';
  END IF;

  v_operator_id := auth.uid();
  SELECT email INTO v_operator_email FROM auth.users WHERE id = v_operator_id;

  -- 2. Atomically update all platform rows
  UPDATE public.app_version_policies
  SET 
    emergency_bypass_enabled = p_enabled,
    updated_at = timezone('utc'::text, now()),
    updated_by = v_operator_id;
    
  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

  -- 3. Insert audit record
  INSERT INTO public.app_version_policy_audit (
    platform,
    action,
    old_policy,
    new_policy,
    operator_id,
    operator_email,
    confirmation_text
  ) VALUES (
    'ALL',
    CASE WHEN p_enabled THEN 'ENABLE_GLOBAL_BYPASS' ELSE 'DISABLE_GLOBAL_BYPASS' END,
    jsonb_build_object('affected_platforms', v_affected_rows),
    jsonb_build_object('emergency_bypass_enabled', p_enabled),
    v_operator_id,
    v_operator_email,
    p_confirmation
  );

  RETURN jsonb_build_object(
    'success', true,
    'affected_platforms', v_affected_rows,
    'emergency_bypass_enabled', p_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_global_version_enforcement_bypass(BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_global_version_enforcement_bypass(BOOLEAN, TEXT) TO authenticated, service_role;

COMMIT;
