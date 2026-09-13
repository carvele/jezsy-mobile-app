-- Migration: 20260914050000_customer_metadata_protection_and_hardened_fitting_rpcs.sql
-- Description:
-- 1. Protect system-owned metadata on user_measurements (quality_status, requires_review, scan_confidence) from customer self-modification.
-- 2. Restrict reservation_fitting_records and reservation_item_alterations table writes to RPCs only (revoke INSERT/UPDATE/DELETE from authenticated).
-- 3. Harden save_reservation_item_alteration to server-derive reservation_id and product_id from reservation_items.

-- 1. Metadata Protection Trigger on user_measurements
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

    -- Protect scan confidence from arbitrary customer inflation
    IF NEW.scan_confidence IS DISTINCT FROM OLD.scan_confidence
       AND (NEW.scan_confidence > coalesce(OLD.scan_confidence, 0)) THEN
      NEW.scan_confidence := OLD.scan_confidence;
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

DROP TRIGGER IF EXISTS trg_protect_measurement_system_metadata ON public.user_measurements;
CREATE TRIGGER trg_protect_measurement_system_metadata
  BEFORE UPDATE ON public.user_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_measurement_system_metadata();

-- 2. Revoke direct write privileges from client roles on fitting & alteration tables
REVOKE INSERT, UPDATE, DELETE ON public.reservation_fitting_records FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reservation_item_alterations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.reservation_fitting_records TO authenticated;
GRANT SELECT ON public.reservation_item_alterations TO authenticated;

-- 3. Harden save_reservation_item_alteration RPC to server-derive integrity-sensitive keys
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
  v_server_res_id uuid;
  v_server_prod_id uuid;
  v_record_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT public.can_manage_fitting_records() THEN
    RAISE EXCEPTION 'Insufficient permissions to manage item alterations'
      USING ERRCODE = '42501';
  END IF;

  -- Server-derive reservation_id and product_id from canonical reservation_items record
  SELECT reservation_id, product_id INTO v_server_res_id, v_server_prod_id
  FROM public.reservation_items
  WHERE id = _reservation_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation item % not found', _reservation_item_id;
  END IF;

  -- Derive staff identity
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
    v_server_res_id,
    v_server_prod_id,
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
    reservation_id = v_server_res_id,
    product_id = v_server_prod_id,
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
