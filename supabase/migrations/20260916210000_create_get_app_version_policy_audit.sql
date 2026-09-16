-- Minimum-Supported-Mobile-Version Enforcement System: Audit Ledger RPC
-- Migration: 20260916210000_create_get_app_version_policy_audit.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.get_app_version_policy_audit(
  p_platform TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  platform TEXT,
  action TEXT,
  old_policy JSONB,
  new_policy JSONB,
  operator_id UUID,
  operator_email TEXT,
  confirmation_text TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  -- 1. Security Check: Staff or Admin role required
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Access denied: staff or admin privileges required';
  END IF;

  -- 2. Bound limit safely between 1 and 100
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  -- 3. Query audit table
  RETURN QUERY
  SELECT 
    a.id,
    a.platform,
    a.action,
    a.old_policy,
    a.new_policy,
    a.operator_id,
    a.operator_email,
    a.confirmation_text,
    a.created_at
  FROM public.app_version_policy_audit a
  WHERE 
    (p_platform IS NULL OR a.platform = p_platform OR a.platform = 'ALL')
    AND (p_before IS NULL OR a.created_at < p_before)
  ORDER BY a.created_at DESC
  LIMIT v_limit;
END;
$$;

-- Revoke from public and anon, grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.get_app_version_policy_audit(TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_app_version_policy_audit(TEXT, INTEGER, TIMESTAMPTZ) TO authenticated, service_role;

COMMIT;
