-- =============================================================================
-- Migration: fix_audit_actor_attribution
-- Purpose:   Correct actor-name resolution in get_customer_measurements_for_staff.
--
-- Root cause: v_actor_name was read from `full_name` only (which is NULL for
--   most accounts), so the fallback 'Staff' appeared in the audit log even
--   when the actor was an owner or admin.
--
-- Fix applied:
--   1. Resolve display name from several profile fields in priority order:
--      full_name -> first_name || last_name -> email -> initcap(role) ->
--      'Unknown staff member'. The final fallback is honest -- it never
--      claims an unknown actor was the "Owner".
--   2. Capture v_actor_role separately so logs.details preserves all three
--      identity facets: actor_id (UUID in logs.user_id), actor_name (snapshot),
--      actor_role (role snapshot at action time).
--   3. No schema changes to public.logs -- actor_role stored in details JSONB.
--
-- Append-only: historical logs are NOT touched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_measurements_for_staff(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
  v_rec        record;
BEGIN
  IF v_actor_id IS NULL OR NOT public.can_view_customer_measurements() THEN
    RAISE EXCEPTION 'Insufficient permissions to view customer measurements'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve display name from multiple profile fields in priority order.
  -- 'Unknown staff member' is the final fallback -- never 'Owner', because
  -- an incomplete or corrupted profile must not be attributed to any role.
  SELECT
    coalesce(
      nullif(trim(full_name), ''),
      nullif(trim(concat_ws(' ', first_name, last_name)), ''),
      nullif(trim(email), ''),
      CASE WHEN role IS NOT NULL THEN initcap(role) ELSE NULL END,
      'Unknown staff member'
    ),
    role
  INTO v_actor_name, v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  SELECT
    id, user_id, height, measurements, measurement_source,
    scanned_at, created_at, scan_confidence, per_field_confidence,
    quality_status, requires_review
  INTO v_rec
  FROM public.user_measurements
  WHERE user_id = _customer_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Durable audit log.
  -- logs.user_id  = immutable UUID (persists even if display name changes later).
  -- logs.user_name = display-name snapshot at call time.
  -- details.actor_role = role snapshot stored in JSONB; UI renders "Name . Role".
  INSERT INTO public.logs (
    target_type, target_id, action, user_id, user_name, details
  ) VALUES (
    'profile',
    _customer_id,
    'view_customer_measurements',
    v_actor_id,
    v_actor_name,
    jsonb_build_object(
      'action',          'view_customer_measurements',
      'actor_role',      v_actor_role,
      'customer_id',     _customer_id,
      'scanned_at',      v_rec.scanned_at,
      'requires_review', v_rec.requires_review,
      'timestamp',       now()
    )
  );

  -- Return sanitized object -- weight is NEVER included.
  RETURN jsonb_build_object(
    'id',                   v_rec.id,
    'user_id',              v_rec.user_id,
    'height',               v_rec.height,
    'measurements',         coalesce(v_rec.measurements, '{}'::jsonb),
    'measurement_source',   v_rec.measurement_source,
    'scanned_at',           v_rec.scanned_at,
    'created_at',           v_rec.created_at,
    'scan_confidence',      v_rec.scan_confidence,
    'per_field_confidence',  v_rec.per_field_confidence,
    'quality_status',       v_rec.quality_status,
    'requires_review',      v_rec.requires_review
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_measurements_for_staff(uuid) TO authenticated, service_role;
