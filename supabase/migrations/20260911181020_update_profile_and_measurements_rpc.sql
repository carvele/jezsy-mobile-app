-- Migration: update_profile_and_measurements RPC
-- Enforces atomic profile and measurement updates in a single database transaction.
-- Security: SECURITY INVOKER, self-scoped to auth.uid().

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

    -- Update profile fit preference (updated_at is maintained by trg_touch_updated_at trigger)
    UPDATE public.profiles
    SET fit_preference = _fit_preference
    WHERE id = actor;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Profile not found or access denied for user %', actor;
    END IF;

    -- Upsert user measurements (supports both first-time users and existing records)
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
        scan_confidence = EXCLUDED.scan_confidence,
        per_field_confidence = EXCLUDED.per_field_confidence,
        measurement_source = EXCLUDED.measurement_source;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', actor
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile_and_measurements(
    text, numeric, numeric, jsonb, real, jsonb, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_profile_and_measurements(
    text, numeric, numeric, jsonb, real, jsonb, text
) FROM anon, PUBLIC;
