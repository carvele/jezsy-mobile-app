-- Migration: 20260914060000_customer_provenance_metadata_protection.sql
-- Description:
-- 1. Protect system-owned provenance metadata (measurement_source, scanned_at, per_field_confidence)
--    on public.user_measurements from customer modification.
-- 2. Preserve existing provenance metadata on conflict in update_profile_and_measurements RPC.

CREATE OR REPLACE FUNCTION public.protect_measurement_system_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_staff boolean := public.can_view_customer_measurements();
  v_bust numeric;
  v_waist numeric;
  v_inseam numeric;
  v_height numeric;
BEGIN
  -- If caller is not authorized staff/admin:
  IF NOT v_is_staff THEN
    -- Strictly reject any attempt by customer to self-modify quality_status or requires_review
    IF NEW.quality_status IS DISTINCT FROM OLD.quality_status
       OR NEW.requires_review IS DISTINCT FROM OLD.requires_review THEN
      RAISE EXCEPTION 'Unauthorized: Customers cannot modify system-owned quality_status or requires_review'
        USING ERRCODE = '42501';
    END IF;

    -- Strictly reject any attempt by customer to modify provenance metadata
    IF NEW.measurement_source IS DISTINCT FROM OLD.measurement_source
       OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at
       OR NEW.per_field_confidence IS DISTINCT FROM OLD.per_field_confidence THEN
      RAISE EXCEPTION 'Unauthorized: Customers cannot modify system-owned provenance metadata (measurement_source, scanned_at, per_field_confidence)'
        USING ERRCODE = '42501';
    END IF;

    -- Protect scan confidence from arbitrary customer inflation
    IF NEW.scan_confidence IS DISTINCT FROM OLD.scan_confidence
       AND (NEW.scan_confidence > coalesce(OLD.scan_confidence, 0)) THEN
      RAISE EXCEPTION 'Unauthorized: Customers cannot inflate scan_confidence'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Physiological plausibility guard on measurement updates:
  -- If updated values trip calibration anomaly thresholds, force requires_review
  IF NEW.measurements IS NOT NULL THEN
    v_bust := (NEW.measurements->'bust'->>'valueCm')::numeric;
    v_waist := (NEW.measurements->'waist'->>'valueCm')::numeric;
    v_inseam := (NEW.measurements->'inseam'->>'valueCm')::numeric;
    v_height := NEW.height;

    IF v_bust >= 160 OR v_waist >= 140 OR (v_height > 0 AND v_waist >= v_height) OR (v_height > 0 AND v_inseam >= 0.7 * v_height) THEN
      NEW.quality_status := 'needs_review';
      NEW.requires_review := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Preserve existing provenance on conflict in update_profile_and_measurements
CREATE OR REPLACE FUNCTION public.update_profile_and_measurements(
    _fit_preference text,
    _height numeric DEFAULT NULL,
    _weight numeric DEFAULT NULL,
    _measurements jsonb DEFAULT NULL,
    _scan_confidence real DEFAULT NULL,
    _per_field_confidence jsonb DEFAULT NULL,
    _measurement_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    actor uuid := auth.uid();
    v_updated_count int;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- Update profile fit preference
    UPDATE public.profiles
    SET fit_preference = _fit_preference
    WHERE id = actor;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Profile not found or access denied for user %', actor;
    END IF;

    -- Upsert user measurements (preserve provenance if existing)
    INSERT INTO public.user_measurements (
        user_id,
        height,
        weight,
        measurements,
        scan_confidence,
        per_field_confidence,
        measurement_source
    ) VALUES (
        actor,
        _height,
        _weight,
        _measurements,
        _scan_confidence,
        _per_field_confidence,
        _measurement_source
    )
    ON CONFLICT (user_id) DO UPDATE SET
        height = EXCLUDED.height,
        weight = EXCLUDED.weight,
        measurements = EXCLUDED.measurements,
        scan_confidence = coalesce(user_measurements.scan_confidence, EXCLUDED.scan_confidence),
        per_field_confidence = coalesce(user_measurements.per_field_confidence, EXCLUDED.per_field_confidence),
        measurement_source = coalesce(user_measurements.measurement_source, EXCLUDED.measurement_source);

    RETURN jsonb_build_object(
        'success', true,
        'user_id', actor
    );
END;
$$;
