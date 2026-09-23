-- ============================================================================
-- Migration: 20260924013600_outfit_planner_core.sql
-- Description: Phase H1 Outfit Planner Core: planned_outfits persistence,
--              real expected-revision OCC, immutable snapshots, catalog timezone
--              validation, internal wear-mutation primitive, canonical RPCs.
-- ============================================================================

-- 1. Timezone Validation Catalog Helper
CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = tz
  );
$$;

-- 2. Create planned_outfits Table
CREATE TABLE IF NOT EXISTS public.planned_outfits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  planned_date DATE NOT NULL,
  slot TEXT NOT NULL DEFAULT 'all_day' CHECK (slot IN ('all_day', 'day', 'evening', 'workout')),
  plan_timezone TEXT NOT NULL,
  saved_outfit_id UUID REFERENCES public.saved_outfits(id) ON DELETE SET NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (pg_catalog.jsonb_typeof(items) = 'array'),
  occasion TEXT,
  climate_context JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (pg_catalog.jsonb_typeof(climate_context) = 'array'),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'worn', 'skipped', 'cancelled', 'unconfirmed')),
  worn_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'saved_outfit', 'style_advisor', 'mannequin', 'capsule', 'trip')),
  source_ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT chk_valid_plan_tz CHECK (public.is_valid_timezone(plan_timezone))
);

-- Partial Unique Index: only active planned looks enforce uniqueness on (user_id, planned_date, slot)
CREATE UNIQUE INDEX IF NOT EXISTS uq_planned_outfits_active 
  ON public.planned_outfits (user_id, planned_date, slot) 
  WHERE (status = 'planned');

-- Additional performance indices
CREATE INDEX IF NOT EXISTS idx_planned_outfits_user_date 
  ON public.planned_outfits (user_id, planned_date);
CREATE INDEX IF NOT EXISTS idx_planned_outfits_user_status 
  ON public.planned_outfits (user_id, status);

-- 3. Ownership Verification Trigger on saved_outfit_id
CREATE OR REPLACE FUNCTION public.check_planned_outfit_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.saved_outfit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.saved_outfits 
      WHERE id = NEW.saved_outfit_id AND user_id = NEW.user_id AND deleted = false
    ) THEN
      RAISE EXCEPTION 'Ownership violation: saved_outfit % does not belong to user % or is deleted', 
        NEW.saved_outfit_id, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planned_outfit_ownership ON public.planned_outfits;
CREATE TRIGGER trg_planned_outfit_ownership
  BEFORE INSERT OR UPDATE ON public.planned_outfits
  FOR EACH ROW EXECUTE FUNCTION public.check_planned_outfit_ownership();

-- 4. Shared Canonical Wear-Count Database Primitive (Internal Only)
CREATE OR REPLACE FUNCTION public.record_item_wear(
  p_item_id UUID,
  p_effective_wear_at TIMESTAMPTZ
)
RETURNS public.wardrobe_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.wardrobe_items;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  UPDATE public.wardrobe_items
  SET wear_count = wear_count + 1,
      last_worn_at = GREATEST(COALESCE(last_worn_at, p_effective_wear_at), p_effective_wear_at)
  WHERE id = p_item_id
    AND user_id = v_user_id
    AND deleted = false
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wardrobe item % not found, deleted, or not owned by caller', p_item_id;
  END IF;

  RETURN v_row;
END;
$$;

-- Secure internal primitive: REVOKE ALL from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.record_item_wear(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- 5. Adapt Existing public.increment_wear_count to Delegate to Internal Primitive
-- Preserves exact signature, security, and behavior for existing Wear Today
CREATE OR REPLACE FUNCTION public.increment_wear_count(p_item_id UUID)
RETURNS public.wardrobe_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.record_item_wear(p_item_id, pg_catalog.clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.increment_wear_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_wear_count(UUID) TO authenticated;

-- 6. Canonical Planner Mutation RPCs

-- 6.1 create_planned_outfit
CREATE OR REPLACE FUNCTION public.create_planned_outfit(
  p_planned_date DATE,
  p_slot TEXT,
  p_plan_timezone TEXT,
  p_items JSONB,
  p_occasion TEXT DEFAULT NULL,
  p_climate_context JSONB DEFAULT '[]'::jsonb,
  p_notes TEXT DEFAULT NULL,
  p_saved_outfit_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT 'manual',
  p_source_ref_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_elem JSONB;
  v_item_id UUID;
  v_item_ids UUID[] := ARRAY[]::UUID[];
  v_verified_count INT;
  v_new_plan public.planned_outfits;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  -- Timezone validation
  IF NOT public.is_valid_timezone(p_plan_timezone) THEN
    RAISE EXCEPTION 'Invalid timezone: % is not a recognized IANA timezone.', p_plan_timezone;
  END IF;

  -- Slot validation
  IF p_slot NOT IN ('all_day', 'day', 'evening', 'workout') THEN
    RAISE EXCEPTION 'Invalid slot: must be all_day, day, evening, or workout.';
  END IF;

  -- Slot collision rule: all_day is mutually exclusive with segmented slots
  IF p_slot = 'all_day' THEN
    IF EXISTS (
      SELECT 1 FROM public.planned_outfits
      WHERE user_id = v_user_id AND planned_date = p_planned_date AND status = 'planned'
    ) THEN
      RAISE EXCEPTION 'Slot collision: an active plan already exists for this date; all_day cannot coexist with any other slot.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.planned_outfits
      WHERE user_id = v_user_id AND planned_date = p_planned_date AND slot = 'all_day' AND status = 'planned'
    ) THEN
      RAISE EXCEPTION 'Slot collision: an active all_day plan already exists for this date.';
    END IF;
  END IF;

  -- Snapshot validation
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid snapshot: items must be a JSON array.';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) < 1 OR pg_catalog.jsonb_array_length(p_items) > 10 THEN
    RAISE EXCEPTION 'Invalid snapshot: item count must be between 1 and 10.';
  END IF;

  IF pg_catalog.length(p_items::TEXT) > 16384 THEN
    RAISE EXCEPTION 'Invalid snapshot: payload exceeds 16KB limit.';
  END IF;

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    IF v_elem->>'id' IS NULL THEN
      RAISE EXCEPTION 'Invalid snapshot item: missing required id property.';
    END IF;

    BEGIN
      v_item_id := (v_elem->>'id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid snapshot item: id % is not a valid UUID.', v_elem->>'id';
    END;

    IF v_elem->>'name' IS NULL OR v_elem->>'category' IS NULL THEN
      RAISE EXCEPTION 'Invalid snapshot item: missing display fields (name, category).';
    END IF;

    v_item_ids := pg_catalog.array_append(v_item_ids, v_item_id);
  END LOOP;

  -- Check duplicate IDs
  IF (SELECT count(DISTINCT x) FROM unnest(v_item_ids) x) <> pg_catalog.cardinality(v_item_ids) THEN
    RAISE EXCEPTION 'Invalid snapshot: duplicate wardrobe items are not allowed.';
  END IF;

  -- Check ownership and active status of all items
  SELECT count(*) INTO v_verified_count
  FROM public.wardrobe_items
  WHERE id = ANY(v_item_ids)
    AND user_id = v_user_id
    AND deleted = false;

  IF v_verified_count <> pg_catalog.cardinality(v_item_ids) THEN
    RAISE EXCEPTION 'Invalid snapshot: one or more items do not exist, are deleted, or belong to another user.';
  END IF;

  -- Insert planned outfit
  INSERT INTO public.planned_outfits (
    user_id,
    planned_date,
    slot,
    plan_timezone,
    saved_outfit_id,
    items,
    occasion,
    climate_context,
    notes,
    status,
    source_type,
    source_ref_id,
    revision
  ) VALUES (
    v_user_id,
    p_planned_date,
    p_slot,
    p_plan_timezone,
    p_saved_outfit_id,
    p_items,
    p_occasion,
    COALESCE(p_climate_context, '[]'::jsonb),
    p_notes,
    'planned',
    COALESCE(p_source_type, 'manual'),
    p_source_ref_id,
    1
  ) RETURNING * INTO v_new_plan;

  RETURN pg_catalog.to_jsonb(v_new_plan);
END;
$$;

-- 6.2 update_planned_outfit_metadata
CREATE OR REPLACE FUNCTION public.update_planned_outfit_metadata(
  p_plan_id UUID,
  p_expected_revision INT,
  p_slot TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_climate_context JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan public.planned_outfits;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_outfits
  WHERE id = p_plan_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or unauthorized.';
  END IF;

  IF v_plan.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'OCC_CONFLICT: plan was modified concurrently (expected %, current %)',
      p_expected_revision, v_plan.revision USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.status NOT IN ('planned', 'unconfirmed') THEN
    RAISE EXCEPTION 'Invalid operation: cannot edit metadata for % plan.', v_plan.status;
  END IF;

  IF p_slot IS NOT NULL AND p_slot <> v_plan.slot THEN
    IF p_slot NOT IN ('all_day', 'day', 'evening', 'workout') THEN
      RAISE EXCEPTION 'Invalid slot.';
    END IF;

    IF p_slot = 'all_day' THEN
      IF EXISTS (
        SELECT 1 FROM public.planned_outfits
        WHERE user_id = v_user_id AND planned_date = v_plan.planned_date AND status = 'planned' AND id <> p_plan_id
      ) THEN
        RAISE EXCEPTION 'Slot collision: another active plan exists for this date.';
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.planned_outfits
        WHERE user_id = v_user_id AND planned_date = v_plan.planned_date AND slot = 'all_day' AND status = 'planned' AND id <> p_plan_id
      ) THEN
        RAISE EXCEPTION 'Slot collision: an active all_day plan already exists for this date.';
      END IF;
    END IF;
  END IF;

  UPDATE public.planned_outfits
  SET slot = COALESCE(p_slot, slot),
      notes = COALESCE(p_notes, notes),
      climate_context = COALESCE(p_climate_context, climate_context),
      updated_at = v_now,
      revision = revision + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  RETURN pg_catalog.to_jsonb(v_plan);
END;
$$;

-- 6.3 reschedule_planned_outfit
CREATE OR REPLACE FUNCTION public.reschedule_planned_outfit(
  p_plan_id UUID,
  p_expected_revision INT,
  p_new_date DATE,
  p_new_slot TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan public.planned_outfits;
  v_target_slot TEXT;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_outfits
  WHERE id = p_plan_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or unauthorized.';
  END IF;

  IF v_plan.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'OCC_CONFLICT: plan was modified concurrently (expected %, current %)',
      p_expected_revision, v_plan.revision USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.status NOT IN ('planned', 'unconfirmed') THEN
    RAISE EXCEPTION 'Invalid operation: cannot reschedule % plan.', v_plan.status;
  END IF;

  v_target_slot := COALESCE(p_new_slot, v_plan.slot);
  IF v_target_slot NOT IN ('all_day', 'day', 'evening', 'workout') THEN
    RAISE EXCEPTION 'Invalid slot.';
  END IF;

  -- Collision check on target date/slot
  IF v_target_slot = 'all_day' THEN
    IF EXISTS (
      SELECT 1 FROM public.planned_outfits
      WHERE user_id = v_user_id AND planned_date = p_new_date AND status = 'planned' AND id <> p_plan_id
    ) THEN
      RAISE EXCEPTION 'Slot collision: an active plan already exists for target date.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.planned_outfits
      WHERE user_id = v_user_id AND planned_date = p_new_date AND slot = 'all_day' AND status = 'planned' AND id <> p_plan_id
    ) THEN
      RAISE EXCEPTION 'Slot collision: an active all_day plan already exists for target date.';
    END IF;
  END IF;

  UPDATE public.planned_outfits
  SET planned_date = p_new_date,
      slot = v_target_slot,
      status = 'planned',
      updated_at = v_now,
      revision = revision + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  RETURN pg_catalog.to_jsonb(v_plan);
END;
$$;

-- 6.4 confirm_planned_outfit_worn
CREATE OR REPLACE FUNCTION public.confirm_planned_outfit_worn(
  p_plan_id UUID,
  p_expected_revision INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan public.planned_outfits;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_local_current_date DATE;
  v_effective_wear_at TIMESTAMPTZ;
  v_snapshot_item_ids UUID[];
  v_active_worn_ids UUID[];
  v_item_id UUID;
  v_filtered_worn_items JSONB;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_outfits
  WHERE id = p_plan_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or unauthorized.';
  END IF;

  IF v_plan.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'OCC_CONFLICT: plan was modified concurrently (expected %, current %)',
      p_expected_revision, v_plan.revision USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.status NOT IN ('planned', 'unconfirmed') THEN
    RAISE EXCEPTION 'Invalid transition: cannot confirm wear from status %', v_plan.status;
  END IF;

  -- Temporal evaluation in plan timezone
  v_local_current_date := (v_now AT TIME ZONE v_plan.plan_timezone)::DATE;

  IF v_plan.planned_date > v_local_current_date THEN
    RAISE EXCEPTION 'Cannot confirm wear for future planned date % (current local date is %)', 
      v_plan.planned_date, v_local_current_date USING ERRCODE = 'P0002';
  ELSIF v_plan.planned_date < v_local_current_date THEN
    v_effective_wear_at := (v_plan.planned_date::TEXT || ' 12:00:00')::TIMESTAMP AT TIME ZONE v_plan.plan_timezone;
  ELSE
    v_effective_wear_at := v_now;
  END IF;

  -- Snapshot integrity check: zero silent partial wear
  SELECT pg_catalog.array_agg((elem->>'id')::UUID)
  INTO v_snapshot_item_ids
  FROM pg_catalog.jsonb_array_elements(v_plan.items) elem;

  SELECT pg_catalog.array_agg(id)
  INTO v_active_worn_ids
  FROM public.wardrobe_items
  WHERE id = ANY(v_snapshot_item_ids)
    AND user_id = v_user_id
    AND deleted = false;

  IF v_active_worn_ids IS NULL 
     OR pg_catalog.cardinality(v_active_worn_ids) <> pg_catalog.cardinality(v_snapshot_item_ids) THEN
    RAISE EXCEPTION 'REPAIR_REQUIRED: One or more garments in this look have been deleted or are unavailable. Please edit and confirm what was actually worn.'
      USING ERRCODE = 'P0003';
  END IF;

  -- Execute wear increment via canonical internal primitive
  FOREACH v_item_id IN ARRAY v_active_worn_ids
  LOOP
    PERFORM public.record_item_wear(v_item_id, v_effective_wear_at);
  END LOOP;

  -- Update plan status
  UPDATE public.planned_outfits
  SET status = 'worn',
      worn_at = v_effective_wear_at,
      confirmed_at = v_now,
      updated_at = v_now,
      revision = revision + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  -- Strict filtered worn snapshot (matching active IDs only)
  SELECT pg_catalog.jsonb_agg(elem)
  INTO v_filtered_worn_items
  FROM pg_catalog.jsonb_array_elements(v_plan.items) elem
  WHERE (elem->>'id')::UUID = ANY(v_active_worn_ids);

  v_result := pg_catalog.jsonb_build_object(
    'plan_id', v_plan.id,
    'saved_outfit_id', v_plan.saved_outfit_id,
    'item_ids', pg_catalog.to_jsonb(v_active_worn_ids),
    'worn_items', v_filtered_worn_items,
    'occasion', v_plan.occasion,
    'effective_wear_at', v_effective_wear_at,
    'confirmed_at', v_now,
    'new_revision', v_plan.revision
  );

  RETURN v_result;
END;
$$;

-- 6.5 skip_planned_outfit
CREATE OR REPLACE FUNCTION public.skip_planned_outfit(
  p_plan_id UUID,
  p_expected_revision INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan public.planned_outfits;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_outfits
  WHERE id = p_plan_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or unauthorized.';
  END IF;

  IF v_plan.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'OCC_CONFLICT: plan was modified concurrently (expected %, current %)',
      p_expected_revision, v_plan.revision USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.status NOT IN ('planned', 'unconfirmed') THEN
    RAISE EXCEPTION 'Invalid transition: cannot skip % plan.', v_plan.status;
  END IF;

  UPDATE public.planned_outfits
  SET status = 'skipped',
      updated_at = v_now,
      revision = revision + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  RETURN pg_catalog.to_jsonb(v_plan);
END;
$$;

-- 6.6 cancel_planned_outfit
CREATE OR REPLACE FUNCTION public.cancel_planned_outfit(
  p_plan_id UUID,
  p_expected_revision INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_plan public.planned_outfits;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_outfits
  WHERE id = p_plan_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or unauthorized.';
  END IF;

  IF v_plan.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'OCC_CONFLICT: plan was modified concurrently (expected %, current %)',
      p_expected_revision, v_plan.revision USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.status NOT IN ('planned', 'unconfirmed') THEN
    RAISE EXCEPTION 'Invalid transition: cannot cancel % plan.', v_plan.status;
  END IF;

  UPDATE public.planned_outfits
  SET status = 'cancelled',
      updated_at = v_now,
      revision = revision + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  RETURN pg_catalog.to_jsonb(v_plan);
END;
$$;

-- 6.7 get_planned_outfits_range (with lazy calendar-date unconfirmed reconciliation)
CREATE OR REPLACE FUNCTION public.get_planned_outfits_range(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF public.planned_outfits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authenticated user context required.';
  END IF;

  -- Lazy calendar reconciliation: transition overdue plans to 'unconfirmed'
  -- Evaluated in each plan's own IANA timezone: triggered when current local date >= planned_date + 2
  UPDATE public.planned_outfits
  SET status = 'unconfirmed',
      updated_at = pg_catalog.clock_timestamp(),
      revision = revision + 1
  WHERE user_id = v_user_id
    AND status = 'planned'
    AND (planned_date + 2) <= (pg_catalog.clock_timestamp() AT TIME ZONE plan_timezone)::DATE;

  RETURN QUERY
  SELECT * FROM public.planned_outfits
  WHERE user_id = v_user_id
    AND planned_date >= p_start_date
    AND planned_date <= p_end_date
  ORDER BY planned_date ASC, slot ASC;
END;
$$;

-- 7. Grant Privileges on Canonical RPCs to authenticated
GRANT EXECUTE ON FUNCTION public.create_planned_outfit(DATE, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_planned_outfit_metadata(UUID, INT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_planned_outfit(UUID, INT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_planned_outfit_worn(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_planned_outfit(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_planned_outfit(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_planned_outfits_range(DATE, DATE) TO authenticated;

-- 8. Row Level Security on planned_outfits: Strict Read-Only via REST
ALTER TABLE public.planned_outfits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.planned_outfits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planned_outfits TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'planned_outfits' 
      AND policyname = 'planned_outfits_select_policy'
  ) THEN
    CREATE POLICY planned_outfits_select_policy ON public.planned_outfits
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
