-- Migration: 20260914040000_customer_measurement_privacy_and_fitting_records.sql
-- Purpose: Enforce database-level privacy boundaries for customer body measurements,
-- capability-gated staff read RPC with audit logging, and introduce two-tier
-- reservation fitting sessions and item alteration records.

-- 1. Schema Enhancements to public.user_measurements
ALTER TABLE public.user_measurements
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'verified'
    CONSTRAINT user_measurements_quality_status_check
    CHECK (quality_status IN ('verified', 'acceptable', 'needs_review')),
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT false;

-- Backfill existing rows with low confidence or anomalous measurements
UPDATE public.user_measurements
SET
  quality_status = 'needs_review',
  requires_review = true
WHERE
  (scan_confidence IS NOT NULL AND scan_confidence < 0.60)
  OR (
    coalesce((measurements->'waist'->>'valueCm')::numeric, (measurements->>'waist')::numeric, 0) >= 140
    OR coalesce((measurements->'bust'->>'valueCm')::numeric, (measurements->>'bust')::numeric, 0) >= 150
    OR (
      height IS NOT NULL AND height > 0 AND (
        coalesce((measurements->'waist'->>'valueCm')::numeric, (measurements->>'waist')::numeric, 0) >= height
        OR coalesce(
          (measurements->'inseam'->>'valueCm')::numeric,
          (measurements->>'inseam')::numeric,
          (measurements->'insideLegLength'->>'valueCm')::numeric,
          (measurements->>'insideLegLength')::numeric,
          0
        ) >= (height * 0.70)
      )
    )
  );

-- 2. Capabilities
CREATE OR REPLACE FUNCTION public.can_view_customer_measurements()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted = false
    AND is_blocked = false
    AND coalesce(employment_status, 'active') = 'active';

  -- Phase 1: Owner and Admin permitted by default.
  -- General staff denied by default until explicit fitting role assignment.
  RETURN coalesce(v_role IN ('admin', 'owner'), false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_view_customer_measurements() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_fitting_records()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted = false
    AND is_blocked = false
    AND coalesce(employment_status, 'active') = 'active';

  RETURN coalesce(v_role IN ('admin', 'owner'), false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_fitting_records() TO authenticated, service_role;

-- 3. Strict RLS on public.user_measurements
ALTER TABLE public.user_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for own measurements or admin" ON public.user_measurements;
DROP POLICY IF EXISTS "Users can view own measurements" ON public.user_measurements;
DROP POLICY IF EXISTS "Users can insert own measurements" ON public.user_measurements;
DROP POLICY IF EXISTS "Users can update own measurements" ON public.user_measurements;
DROP POLICY IF EXISTS "Users can delete own measurements" ON public.user_measurements;
DROP POLICY IF EXISTS "Enable select for own measurements or owner" ON public.user_measurements;
DROP POLICY IF EXISTS "Enable insert for own measurements or owner" ON public.user_measurements;
DROP POLICY IF EXISTS "Enable update/delete for own measurements or owner" ON public.user_measurements;

-- Customer-only direct table access
CREATE POLICY "customer_select_own_measurements"
  ON public.user_measurements
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "customer_insert_own_measurements"
  ON public.user_measurements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "customer_update_own_measurements"
  ON public.user_measurements
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "customer_delete_own_measurements"
  ON public.user_measurements
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 4. Authorized Staff Read RPC (Never returns weight, creates durable audit log)
CREATE OR REPLACE FUNCTION public.get_customer_measurements_for_staff(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_rec record;
BEGIN
  IF v_actor_id IS NULL OR NOT public.can_view_customer_measurements() THEN
    RAISE EXCEPTION 'Insufficient permissions to view customer measurements'
      USING ERRCODE = '42501';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor_id;

  SELECT
    id,
    user_id,
    height,
    measurements,
    measurement_source,
    scanned_at,
    created_at,
    scan_confidence,
    per_field_confidence,
    quality_status,
    requires_review
  INTO v_rec
  FROM public.user_measurements
  WHERE user_id = _customer_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Durable audit log
  INSERT INTO public.logs (
    target_type,
    target_id,
    action,
    user_id,
    user_name,
    details
  ) VALUES (
    'profile',
    _customer_id,
    'view_customer_measurements',
    v_actor_id,
    coalesce(v_actor_name, 'Staff'),
    jsonb_build_object(
      'action', 'view_customer_measurements',
      'customer_id', _customer_id,
      'scanned_at', v_rec.scanned_at,
      'requires_review', v_rec.requires_review,
      'timestamp', now()
    )
  );

  -- Return sanitized object - NEVER includes weight
  RETURN jsonb_build_object(
    'id', v_rec.id,
    'user_id', v_rec.user_id,
    'height', v_rec.height,
    'measurements', coalesce(v_rec.measurements, '{}'::jsonb),
    'measurement_source', v_rec.measurement_source,
    'scanned_at', v_rec.scanned_at,
    'created_at', v_rec.created_at,
    'scan_confidence', v_rec.scan_confidence,
    'per_field_confidence', v_rec.per_field_confidence,
    'quality_status', v_rec.quality_status,
    'requires_review', v_rec.requires_review
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_measurements_for_staff(uuid) TO authenticated, service_role;

-- 5. Reservation Fitting Records (Session-level)
CREATE TABLE IF NOT EXISTS public.reservation_fitting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.reservations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  confirmed_body_measurements jsonb DEFAULT '{}'::jsonb,
  fitting_status text NOT NULL DEFAULT 'pending' CHECK (fitting_status IN ('pending', 'fitted', 'completed')),
  customer_fitting_summary text,
  staff_internal_notes text,
  fitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  fitted_by_name text,
  fitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_fitting_records_res_id
  ON public.reservation_fitting_records(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_fitting_records_cust_id
  ON public.reservation_fitting_records(customer_id);

ALTER TABLE public.reservation_fitting_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_fitting_records"
  ON public.reservation_fitting_records
  FOR ALL
  TO authenticated
  USING (public.can_manage_fitting_records())
  WITH CHECK (public.can_manage_fitting_records());

-- 6. Reservation Item Alterations (Multi-item line level)
CREATE TABLE IF NOT EXISTS public.reservation_item_alterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_item_id uuid NOT NULL UNIQUE REFERENCES public.reservation_items(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  hem_adjustment_cm numeric DEFAULT 0,
  sleeve_adjustment_cm numeric DEFAULT 0,
  waist_adjustment_cm numeric DEFAULT 0,
  shoulders_adjustment_cm numeric DEFAULT 0,
  other_adjustments jsonb DEFAULT '{}'::jsonb,
  alteration_status text NOT NULL DEFAULT 'pending' CHECK (alteration_status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  customer_alteration_summary text,
  staff_internal_notes text,
  assigned_tailor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_tailor_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_item_alterations_res_item_id
  ON public.reservation_item_alterations(reservation_item_id);
CREATE INDEX IF NOT EXISTS idx_reservation_item_alterations_res_id
  ON public.reservation_item_alterations(reservation_id);

ALTER TABLE public.reservation_item_alterations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_item_alterations"
  ON public.reservation_item_alterations
  FOR ALL
  TO authenticated
  USING (public.can_manage_fitting_records())
  WITH CHECK (public.can_manage_fitting_records());

-- 7. Operational RPCs for Fitting Sessions & Alterations

-- Save or update session fitting record
CREATE OR REPLACE FUNCTION public.save_reservation_fitting_record(
  _reservation_id uuid,
  _confirmed_body_measurements jsonb,
  _fitting_status text,
  _customer_fitting_summary text,
  _staff_internal_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_customer_id uuid;
  v_record_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT public.can_manage_fitting_records() THEN
    RAISE EXCEPTION 'Insufficient permissions to manage fitting records'
      USING ERRCODE = '42501';
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM public.reservations
  WHERE id = _reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor_id;

  INSERT INTO public.reservation_fitting_records (
    reservation_id,
    customer_id,
    confirmed_body_measurements,
    fitting_status,
    customer_fitting_summary,
    staff_internal_notes,
    fitted_by,
    fitted_by_name,
    fitted_at,
    updated_at
  ) VALUES (
    _reservation_id,
    v_customer_id,
    coalesce(_confirmed_body_measurements, '{}'::jsonb),
    coalesce(_fitting_status, 'fitted'),
    _customer_fitting_summary,
    _staff_internal_notes,
    v_actor_id,
    coalesce(v_actor_name, 'Staff'),
    now(),
    now()
  )
  ON CONFLICT (reservation_id) DO UPDATE SET
    confirmed_body_measurements = coalesce(_confirmed_body_measurements, reservation_fitting_records.confirmed_body_measurements),
    fitting_status = coalesce(_fitting_status, reservation_fitting_records.fitting_status),
    customer_fitting_summary = coalesce(_customer_fitting_summary, reservation_fitting_records.customer_fitting_summary),
    staff_internal_notes = coalesce(_staff_internal_notes, reservation_fitting_records.staff_internal_notes),
    fitted_by = v_actor_id,
    fitted_by_name = coalesce(v_actor_name, 'Staff'),
    fitted_at = now(),
    updated_at = now()
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_reservation_fitting_record(uuid, jsonb, text, text, text) TO authenticated, service_role;

-- Save or update item alteration
CREATE OR REPLACE FUNCTION public.save_reservation_item_alteration(
  _reservation_item_id uuid,
  _reservation_id uuid,
  _product_id uuid,
  _hem_cm numeric,
  _sleeve_cm numeric,
  _waist_cm numeric,
  _shoulders_cm numeric,
  _other_adjustments jsonb,
  _alteration_status text,
  _customer_summary text,
  _staff_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_record_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT public.can_manage_fitting_records() THEN
    RAISE EXCEPTION 'Insufficient permissions to manage item alterations'
      USING ERRCODE = '42501';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor_id;

  INSERT INTO public.reservation_item_alterations (
    reservation_item_id,
    reservation_id,
    product_id,
    hem_adjustment_cm,
    sleeve_adjustment_cm,
    waist_adjustment_cm,
    shoulders_adjustment_cm,
    other_adjustments,
    alteration_status,
    customer_alteration_summary,
    staff_internal_notes,
    assigned_tailor_id,
    assigned_tailor_name,
    updated_at
  ) VALUES (
    _reservation_item_id,
    _reservation_id,
    _product_id,
    coalesce(_hem_cm, 0),
    coalesce(_sleeve_cm, 0),
    coalesce(_waist_cm, 0),
    coalesce(_shoulders_cm, 0),
    coalesce(_other_adjustments, '{}'::jsonb),
    coalesce(_alteration_status, 'pending'),
    _customer_summary,
    _staff_notes,
    v_actor_id,
    coalesce(v_actor_name, 'Staff'),
    now()
  )
  ON CONFLICT (reservation_item_id) DO UPDATE SET
    hem_adjustment_cm = coalesce(_hem_cm, reservation_item_alterations.hem_adjustment_cm),
    sleeve_adjustment_cm = coalesce(_sleeve_cm, reservation_item_alterations.sleeve_adjustment_cm),
    waist_adjustment_cm = coalesce(_waist_cm, reservation_item_alterations.waist_adjustment_cm),
    shoulders_adjustment_cm = coalesce(_shoulders_cm, reservation_item_alterations.shoulders_adjustment_cm),
    other_adjustments = coalesce(_other_adjustments, reservation_item_alterations.other_adjustments),
    alteration_status = coalesce(_alteration_status, reservation_item_alterations.alteration_status),
    customer_alteration_summary = coalesce(_customer_summary, reservation_item_alterations.customer_alteration_summary),
    staff_internal_notes = coalesce(_staff_notes, reservation_item_alterations.staff_internal_notes),
    assigned_tailor_id = v_actor_id,
    assigned_tailor_name = coalesce(v_actor_name, 'Staff'),
    updated_at = now()
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_reservation_item_alteration(uuid, uuid, uuid, numeric, numeric, numeric, numeric, jsonb, text, text, text) TO authenticated, service_role;

-- Customer-safe read RPC for reservation fitting summary (strictly omits staff_internal_notes)
CREATE OR REPLACE FUNCTION public.get_customer_reservation_fitting(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    rfr.id,
    rfr.reservation_id,
    rfr.confirmed_body_measurements,
    rfr.fitting_status,
    rfr.customer_fitting_summary,
    rfr.fitted_at
  INTO v_rec
  FROM public.reservation_fitting_records rfr
  JOIN public.reservations r ON r.id = rfr.reservation_id
  WHERE rfr.reservation_id = _reservation_id
    AND (r.customer_id = auth.uid() OR public.can_manage_fitting_records());

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_rec.id,
    'reservation_id', v_rec.reservation_id,
    'confirmed_body_measurements', coalesce(v_rec.confirmed_body_measurements, '{}'::jsonb),
    'fitting_status', v_rec.fitting_status,
    'customer_fitting_summary', v_rec.customer_fitting_summary,
    'fitted_at', v_rec.fitted_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_reservation_fitting(uuid) TO authenticated, service_role;
