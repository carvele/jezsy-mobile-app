-- ============================================================================
-- Migration: 20260923230000_persistent_style_dna.sql
-- Description: Persistent Style DNA: append-only preference event stream,
--              server-authoritative materialized projection, advisory-lock
--              concurrency serialization, and dimension-scoped aggregation.
-- ============================================================================

-- 1. Create append-only event stream table
CREATE TABLE IF NOT EXISTS public.style_preference_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_schema_version INT NOT NULL DEFAULT 1 CHECK (event_schema_version >= 1),
  event_type VARCHAR(50) NOT NULL CHECK (
    event_type IN ('save_look', 'wear_outfit', 'remix_commit', 'explicit_feedback', 'explicit_setting', 'reset_learned_preferences')
  ),
  preference_action_id UUID,
  signal_weight NUMERIC(4, 2) NOT NULL CHECK (signal_weight >= -1.00 AND signal_weight <= 1.00),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(payload) = 'object'),
  client_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Indexes for efficient aggregation and action deduplication
CREATE INDEX IF NOT EXISTS idx_style_events_user_time 
  ON public.style_preference_events (user_id, client_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_style_events_user_type 
  ON public.style_preference_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_style_events_action_id 
  ON public.style_preference_events (user_id, preference_action_id) 
  WHERE preference_action_id IS NOT NULL;

-- 2. Create materialized profile projection table
CREATE TABLE IF NOT EXISTS public.user_style_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  schema_version INT NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  palette_affinities JSONB NOT NULL DEFAULT '{}'::jsonb,
  silhouette_affinities JSONB NOT NULL DEFAULT '{}'::jsonb,
  formality_affinities JSONB NOT NULL DEFAULT '{}'::jsonb,
  accessory_affinities JSONB NOT NULL DEFAULT '{}'::jsonb,
  explicit_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  global_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.000 CHECK (global_confidence >= 0.000 AND global_confidence <= 1.000),
  event_count INT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  last_event_timestamp TIMESTAMPTZ,
  learning_reset_at TIMESTAMPTZ,
  projection_computed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 3. Row-Level Security: Strict Server-Owned Authority
ALTER TABLE public.style_preference_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_style_profiles ENABLE ROW LEVEL SECURITY;

-- Idempotent policy creation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'user_style_profiles' 
      AND policyname = 'user_style_profiles_select_policy'
  ) THEN
    CREATE POLICY user_style_profiles_select_policy ON public.user_style_profiles
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Revoke direct mutation rights; all mutations must flow through RPCs
REVOKE ALL ON public.style_preference_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_style_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_style_profiles TO authenticated;

-- ============================================================================
-- Internal Function: aggregate_user_style_dna
-- Description: Deterministic server-side aggregation for palette, silhouette,
--              formality, and accessories with exponential time decay,
--              per-dimension effective evidence, and learning reset cutoff.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aggregate_user_style_dna(
  p_user_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT pg_catalog.clock_timestamp()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reset_at TIMESTAMPTZ;
  v_existing_reset TIMESTAMPTZ;
  v_latest_reset_event TIMESTAMPTZ;
  
  v_palette_map JSONB := '{}'::JSONB;
  v_silhouette_map JSONB := '{}'::JSONB;
  v_formality_map JSONB := '{}'::JSONB;
  v_accessory_map JSONB := '{}'::JSONB;
  v_explicit_prefs JSONB := '{}'::JSONB;
  
  v_global_confidence NUMERIC(4, 3) := 0.000;
  v_total_event_count INT := 0;
  v_learned_effective_evidence NUMERIC := 0.0;
  v_last_ts TIMESTAMPTZ;
BEGIN
  -- 1. Determine Effective Reset Cutoff (Never Regresses)
  SELECT usp.learning_reset_at INTO v_existing_reset
  FROM public.user_style_profiles usp WHERE usp.user_id = p_user_id;

  SELECT MAX(spe.client_timestamp) INTO v_latest_reset_event
  FROM public.style_preference_events spe
  WHERE spe.user_id = p_user_id AND spe.event_type = 'reset_learned_preferences';

  v_reset_at := GREATEST(v_existing_reset, v_latest_reset_event);

  -- 2. Aggregate Explicit Settings (Latest-Wins Semantics)
  WITH latest_settings AS (
    SELECT DISTINCT ON (spe.payload->>'setting_key')
      spe.payload->>'setting_key' AS setting_key,
      spe.payload->>'action' AS action,
      spe.payload->'setting_value' AS setting_value,
      spe.client_timestamp
    FROM public.style_preference_events spe
    WHERE spe.user_id = p_user_id AND spe.event_type = 'explicit_setting'
    ORDER BY spe.payload->>'setting_key', spe.client_timestamp DESC, spe.id DESC
  )
  SELECT pg_catalog.jsonb_object_agg(setting_key, setting_value)
  INTO v_explicit_prefs
  FROM latest_settings
  WHERE action IN ('set', 'update') AND setting_value IS NOT NULL AND setting_value <> 'null'::jsonb;

  IF v_explicit_prefs IS NULL THEN v_explicit_prefs := '{}'::JSONB; END IF;

  -- 3. Prepare Valid Learned Events with Action Deduplication & Decay
  -- Exclude dont_recommend_item from global learned Style DNA evidence
  CREATE TEMP TABLE temp_valid_learned_events ON COMMIT DROP AS
  WITH ranked_events AS (
    SELECT 
      spe.id,
      spe.signal_weight,
      spe.payload,
      spe.client_timestamp,
      (pg_catalog.exp(-0.011552453 * pg_catalog.greatest(0.0, pg_catalog.extract(epoch from (p_as_of - spe.client_timestamp)) / 86400.0))) AS decay_factor,
      ROW_NUMBER() OVER (
        PARTITION BY spe.user_id, COALESCE(spe.preference_action_id, spe.id) 
        ORDER BY spe.signal_weight DESC, spe.client_timestamp DESC
      ) AS rank_in_action
    FROM public.style_preference_events spe
    WHERE spe.user_id = p_user_id
      AND spe.event_type IN ('save_look', 'wear_outfit', 'remix_commit', 'explicit_feedback')
      AND COALESCE(spe.payload->>'feedback_kind', '') <> 'dont_recommend_item'
      AND (v_reset_at IS NULL OR spe.client_timestamp > v_reset_at)
  )
  SELECT id, signal_weight, payload, client_timestamp, decay_factor
  FROM ranked_events
  WHERE rank_in_action = 1;

  -- 4. Aggregate Dimension 1: Palette
  WITH palette_tokens AS (
    SELECT 
      pal.value::TEXT AS token_name,
      t.signal_weight,
      t.decay_factor,
      t.client_timestamp
    FROM temp_valid_learned_events t,
         pg_catalog.jsonb_array_elements_text(COALESCE(t.payload->'palette', '[]'::jsonb)) pal
  ),
  palette_agg AS (
    SELECT 
      token_name,
      pg_catalog.count(*)::int AS raw_samples,
      pg_catalog.round(pg_catalog.sum(pg_catalog.abs(signal_weight) * decay_factor)::numeric, 3) AS effective_samples,
      pg_catalog.round(pg_catalog.least(1.000, pg_catalog.greatest(0.000, (
        (pg_catalog.sum(signal_weight * decay_factor) / pg_catalog.nullif(pg_catalog.sum(decay_factor), 0)) + 1.0) / 2.0
      ))::numeric, 3) AS affinity_score,
      pg_catalog.max(client_timestamp) AS last_signal_at
    FROM palette_tokens
    GROUP BY token_name
  )
  SELECT pg_catalog.jsonb_object_agg(
    token_name,
    pg_catalog.jsonb_build_object(
      'score', affinity_score,
      'rawSampleCount', raw_samples,
      'effectiveSampleCount', effective_samples,
      'confidence', pg_catalog.least(1.000, pg_catalog.round((effective_samples / 10.0)::numeric, 3)),
      'lastSignalAt', last_signal_at
    )
  ) INTO v_palette_map FROM palette_agg;
  IF v_palette_map IS NULL THEN v_palette_map := '{}'::JSONB; END IF;

  -- 5. Aggregate Dimension 2: Silhouettes
  WITH silhouette_tokens AS (
    SELECT 
      sil.value::TEXT AS token_name,
      t.signal_weight,
      t.decay_factor,
      t.client_timestamp
    FROM temp_valid_learned_events t,
         pg_catalog.jsonb_array_elements_text(COALESCE(t.payload->'silhouettes', '[]'::jsonb)) sil
  ),
  silhouette_agg AS (
    SELECT 
      token_name,
      pg_catalog.count(*)::int AS raw_samples,
      pg_catalog.round(pg_catalog.sum(pg_catalog.abs(signal_weight) * decay_factor)::numeric, 3) AS effective_samples,
      pg_catalog.round(pg_catalog.least(1.000, pg_catalog.greatest(0.000, (
        (pg_catalog.sum(signal_weight * decay_factor) / pg_catalog.nullif(pg_catalog.sum(decay_factor), 0)) + 1.0) / 2.0
      ))::numeric, 3) AS affinity_score,
      pg_catalog.max(client_timestamp) AS last_signal_at
    FROM silhouette_tokens
    GROUP BY token_name
  )
  SELECT pg_catalog.jsonb_object_agg(
    token_name,
    pg_catalog.jsonb_build_object(
      'score', affinity_score,
      'rawSampleCount', raw_samples,
      'effectiveSampleCount', effective_samples,
      'confidence', pg_catalog.least(1.000, pg_catalog.round((effective_samples / 10.0)::numeric, 3)),
      'lastSignalAt', last_signal_at
    )
  ) INTO v_silhouette_map FROM silhouette_agg;
  IF v_silhouette_map IS NULL THEN v_silhouette_map := '{}'::JSONB; END IF;

  -- 6. Aggregate Dimension 3: Formality
  WITH formality_tokens AS (
    SELECT 
      form.value::TEXT AS token_name,
      t.signal_weight,
      t.decay_factor,
      t.client_timestamp
    FROM temp_valid_learned_events t,
         pg_catalog.jsonb_array_elements_text(COALESCE(t.payload->'formality', '[]'::jsonb)) form
  ),
  formality_agg AS (
    SELECT 
      token_name,
      pg_catalog.count(*)::int AS raw_samples,
      pg_catalog.round(pg_catalog.sum(pg_catalog.abs(signal_weight) * decay_factor)::numeric, 3) AS effective_samples,
      pg_catalog.round(pg_catalog.least(1.000, pg_catalog.greatest(0.000, (
        (pg_catalog.sum(signal_weight * decay_factor) / pg_catalog.nullif(pg_catalog.sum(decay_factor), 0)) + 1.0) / 2.0
      ))::numeric, 3) AS affinity_score,
      pg_catalog.max(client_timestamp) AS last_signal_at
    FROM formality_tokens
    GROUP BY token_name
  )
  SELECT pg_catalog.jsonb_object_agg(
    token_name,
    pg_catalog.jsonb_build_object(
      'score', affinity_score,
      'rawSampleCount', raw_samples,
      'effectiveSampleCount', effective_samples,
      'confidence', pg_catalog.least(1.000, pg_catalog.round((effective_samples / 10.0)::numeric, 3)),
      'lastSignalAt', last_signal_at
    )
  ) INTO v_formality_map FROM formality_agg;
  IF v_formality_map IS NULL THEN v_formality_map := '{}'::JSONB; END IF;

  -- 7. Aggregate Dimension 4: Accessories
  WITH accessory_tokens AS (
    SELECT 
      acc.value::TEXT AS token_name,
      t.signal_weight,
      t.decay_factor,
      t.client_timestamp
    FROM temp_valid_learned_events t,
         pg_catalog.jsonb_array_elements_text(COALESCE(t.payload->'accessories', '[]'::jsonb)) acc
  ),
  accessory_agg AS (
    SELECT 
      token_name,
      pg_catalog.count(*)::int AS raw_samples,
      pg_catalog.round(pg_catalog.sum(pg_catalog.abs(signal_weight) * decay_factor)::numeric, 3) AS effective_samples,
      pg_catalog.round(pg_catalog.least(1.000, pg_catalog.greatest(0.000, (
        (pg_catalog.sum(signal_weight * decay_factor) / pg_catalog.nullif(pg_catalog.sum(decay_factor), 0)) + 1.0) / 2.0
      ))::numeric, 3) AS affinity_score,
      pg_catalog.max(client_timestamp) AS last_signal_at
    FROM accessory_tokens
    GROUP BY token_name
  )
  SELECT pg_catalog.jsonb_object_agg(
    token_name,
    pg_catalog.jsonb_build_object(
      'score', affinity_score,
      'rawSampleCount', raw_samples,
      'effectiveSampleCount', effective_samples,
      'confidence', pg_catalog.least(1.000, pg_catalog.round((effective_samples / 10.0)::numeric, 3)),
      'lastSignalAt', last_signal_at
    )
  ) INTO v_accessory_map FROM accessory_agg;
  IF v_accessory_map IS NULL THEN v_accessory_map := '{}'::JSONB; END IF;

  -- 8. Compute Total Audit Event Count & Learned Global Confidence
  SELECT pg_catalog.count(*)::int, pg_catalog.max(spe.client_timestamp)
  INTO v_total_event_count, v_last_ts
  FROM public.style_preference_events spe
  WHERE spe.user_id = p_user_id;

  SELECT COALESCE(pg_catalog.sum(t.decay_factor), 0.0)
  INTO v_learned_effective_evidence
  FROM temp_valid_learned_events t;

  -- Learned Global Confidence reflects only valid post-reset effective evidence
  v_global_confidence := pg_catalog.least(1.000, pg_catalog.round((v_learned_effective_evidence / 15.0)::numeric, 3));

  -- 9. Upsert Materialized Projection
  INSERT INTO public.user_style_profiles (
    user_id,
    schema_version,
    palette_affinities,
    silhouette_affinities,
    formality_affinities,
    accessory_affinities,
    explicit_preferences,
    global_confidence,
    event_count,
    last_event_timestamp,
    learning_reset_at,
    projection_computed_at,
    updated_at
  ) VALUES (
    p_user_id,
    1,
    v_palette_map,
    v_silhouette_map,
    v_formality_map,
    v_accessory_map,
    v_explicit_prefs,
    v_global_confidence,
    v_total_event_count,
    v_last_ts,
    v_reset_at,
    p_as_of,
    p_as_of
  )
  ON CONFLICT (user_id) DO UPDATE SET
    palette_affinities = EXCLUDED.palette_affinities,
    silhouette_affinities = EXCLUDED.silhouette_affinities,
    formality_affinities = EXCLUDED.formality_affinities,
    accessory_affinities = EXCLUDED.accessory_affinities,
    explicit_preferences = EXCLUDED.explicit_preferences,
    global_confidence = EXCLUDED.global_confidence,
    event_count = EXCLUDED.event_count,
    last_event_timestamp = EXCLUDED.last_event_timestamp,
    learning_reset_at = EXCLUDED.learning_reset_at,
    projection_computed_at = EXCLUDED.projection_computed_at,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- Security hardening: revoke internal aggregator from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.aggregate_user_style_dna(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Security Definer RPC: sync_and_aggregate_style_dna
-- Description: Ingests batches of preference events, validates schemas,
--              assigns server-authoritative weights, locks per-user, inserts
--              idempotently, aggregates Style DNA, and returns acknowledgements.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_and_aggregate_style_dna(
  p_events JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_event JSONB;
  v_event_id UUID;
  v_event_type TEXT;
  v_server_weight NUMERIC(4, 2);
  v_client_ts TIMESTAMPTZ;
  v_payload JSONB;
  v_sanitized_payload JSONB;
  v_schema_version INT;
  v_action_id UUID;
  v_existing_owner UUID;
  v_inserted_id UUID;
  
  -- Tracking sets
  v_accepted_ids UUID[] := ARRAY[]::UUID[];
  v_duplicate_ids UUID[] := ARRAY[]::UUID[];
  v_rejected_ids JSONB[] := ARRAY[]::JSONB[];
  v_newly_inserted_count INT := 0;
  
  -- Validation vars
  v_action TEXT;
  v_setting_key TEXT;
  v_setting_val JSONB;
  v_feedback_kind TEXT;
  v_key TEXT;
  v_profile RECORD;
  v_result JSONB;
  v_arr_elem JSONB;
BEGIN
  -- 1. Authentication Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid user authentication required.';
  END IF;

  -- 2. Concurrency Control: Serialize per user transaction
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('style_dna_' || v_user_id::text));

  -- 3. Batch Validation
  IF p_events IS NULL OR pg_catalog.jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'Invalid argument: p_events must be a JSON array.';
  END IF;

  IF pg_catalog.jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'Batch limit exceeded: maximum 50 events per sync call.';
  END IF;

  -- 4. Process Each Event with Narrow Per-Event Error Trapping
  FOR v_event IN SELECT * FROM pg_catalog.jsonb_array_elements(p_events)
  LOOP
    -- Payload byte length check (max 8KB)
    IF pg_catalog.octet_length(v_event::text) > 8192 THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event->>'id', 'reason', 'payload_too_large'));
      CONTINUE;
    END IF;

    -- Guard UUID parsing
    BEGIN
      v_event_id := (v_event->>'id')::UUID;
      IF v_event_id IS NULL THEN RAISE EXCEPTION 'null_id'; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event->>'id', 'reason', 'invalid_uuid'));
      CONTINUE;
    END;

    -- Guard timestamp parsing
    BEGIN
      v_client_ts := (v_event->>'client_timestamp')::TIMESTAMPTZ;
      IF v_client_ts IS NULL THEN RAISE EXCEPTION 'null_timestamp'; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_timestamp'));
      CONTINUE;
    END;

    -- Guard schema version parsing: missing or non-integer is rejected
    IF v_event->'event_schema_version' IS NULL THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_schema_version'));
      CONTINUE;
    END IF;

    BEGIN
      v_schema_version := (v_event->>'event_schema_version')::INT;
      IF v_schema_version <> 1 THEN
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'unsupported_schema_version'));
        CONTINUE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_schema_version'));
      CONTINUE;
    END;

    -- Guard preference_action_id parsing: malformed UUID must be REJECTED, not converted to NULL
    IF v_event->>'preference_action_id' IS NOT NULL THEN
      BEGIN
        v_action_id := (v_event->>'preference_action_id')::UUID;
        IF v_action_id IS NULL THEN RAISE EXCEPTION 'null_action_id'; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_action_id'));
        CONTINUE;
      END;
    ELSE
      v_action_id := NULL;
    END IF;

    -- Guard payload object type
    v_payload := v_event->'payload';
    IF v_payload IS NULL OR pg_catalog.jsonb_typeof(v_payload) <> 'object' THEN
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'payload_must_be_object'));
      CONTINUE;
    END IF;

    -- Validate timestamp bounds
    IF v_client_ts > (v_now + INTERVAL '5 minutes') THEN
      v_client_ts := v_now;
    ELSIF v_client_ts < (v_now - INTERVAL '2 years') THEN
      v_client_ts := v_now - INTERVAL '2 years';
    END IF;

    v_event_type := v_event->>'event_type';

    -- Event-Specific Whitelist, Unknown-Key Rejection & Value Validation
    IF v_event_type IN ('save_look', 'wear_outfit', 'remix_commit') THEN
      FOR v_key IN SELECT pg_catalog.jsonb_object_keys(v_payload)
      LOOP
        IF v_key NOT IN ('palette', 'silhouettes', 'formality', 'accessories', 'outfit_id', 'item_ids', 'replaced_slots') THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'unknown_payload_key_' || v_key));
          GOTO next_event;
        END IF;
      END LOOP;

      -- Validate semantic array formats
      IF v_payload->'palette' IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(v_payload->'palette') <> 'array' OR pg_catalog.jsonb_array_length(v_payload->'palette') > 10 THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_palette_array'));
          CONTINUE;
        END IF;
        FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_payload->'palette')
        LOOP
          IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR pg_catalog.length(v_arr_elem#>>'{}') > 64 THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_palette_element'));
            GOTO next_event;
          END IF;
        END LOOP;
      END IF;

      IF v_payload->'silhouettes' IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(v_payload->'silhouettes') <> 'array' OR pg_catalog.jsonb_array_length(v_payload->'silhouettes') > 10 THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_silhouettes_array'));
          CONTINUE;
        END IF;
        FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_payload->'silhouettes')
        LOOP
          IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR pg_catalog.length(v_arr_elem#>>'{}') > 64 THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_silhouette_element'));
            GOTO next_event;
          END IF;
        END LOOP;
      END IF;

      IF v_payload->'formality' IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(v_payload->'formality') <> 'array' OR pg_catalog.jsonb_array_length(v_payload->'formality') > 10 THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_formality_array'));
          CONTINUE;
        END IF;
        FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_payload->'formality')
        LOOP
          IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR v_arr_elem#>>'{}' NOT IN ('casual', 'smart_casual', 'business_casual', 'business_formal', 'black_tie') THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_formality_element'));
            GOTO next_event;
          END IF;
        END LOOP;
      END IF;

      IF v_payload->'accessories' IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(v_payload->'accessories') <> 'array' OR pg_catalog.jsonb_array_length(v_payload->'accessories') > 10 THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_accessories_array'));
          CONTINUE;
        END IF;
        FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_payload->'accessories')
        LOOP
          IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR pg_catalog.length(v_arr_elem#>>'{}') > 64 THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_accessory_element'));
            GOTO next_event;
          END IF;
        END LOOP;
      END IF;

      IF v_event_type = 'save_look' THEN v_server_weight := 0.80;
      ELSIF v_event_type = 'wear_outfit' THEN v_server_weight := 0.70;
      ELSE v_server_weight := 0.50; END IF;
      v_sanitized_payload := v_payload;

    ELSIF v_event_type = 'explicit_feedback' THEN
      FOR v_key IN SELECT pg_catalog.jsonb_object_keys(v_payload)
      LOOP
        IF v_key NOT IN ('feedback_kind', 'palette', 'silhouettes', 'formality', 'accessories') THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'unknown_payload_key_' || v_key));
          GOTO next_event;
        END IF;
      END LOOP;

      v_feedback_kind := v_payload->>'feedback_kind';
      IF v_feedback_kind = 'love_look' THEN
        v_server_weight := 1.00;
        v_sanitized_payload := v_payload;
      ELSIF v_feedback_kind = 'not_my_style' THEN
        v_server_weight := -0.50;
        v_sanitized_payload := v_payload;
      ELSIF v_feedback_kind = 'too_formal' THEN
        v_server_weight := -0.40;
        -- Dimension Scoping: Formality feedback affects FORMALITY ONLY
        v_sanitized_payload := pg_catalog.jsonb_build_object(
          'feedback_kind', v_feedback_kind,
          'formality', COALESCE(v_payload->'formality', '[]'::jsonb)
        );
      ELSIF v_feedback_kind = 'too_casual' THEN
        v_server_weight := -0.40;
        -- Dimension Scoping: Formality feedback affects FORMALITY ONLY
        v_sanitized_payload := pg_catalog.jsonb_build_object(
          'feedback_kind', v_feedback_kind,
          'formality', COALESCE(v_payload->'formality', '[]'::jsonb)
        );
      ELSIF v_feedback_kind = 'dont_recommend_item' THEN
        v_server_weight := 0.00;
        v_sanitized_payload := v_payload;
      ELSE
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_feedback_kind'));
        CONTINUE;
      END IF;

    ELSIF v_event_type = 'explicit_setting' THEN
      FOR v_key IN SELECT pg_catalog.jsonb_object_keys(v_payload)
      LOOP
        IF v_key NOT IN ('action', 'setting_key', 'setting_value') THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'unknown_payload_key_' || v_key));
          GOTO next_event;
        END IF;
      END LOOP;

      v_action := v_payload->>'action';
      v_setting_key := v_payload->>'setting_key';
      v_setting_val := v_payload->'setting_value';

      -- Validate setting_key whitelist BEFORE action check (applies to set, update, AND clear)
      IF v_setting_key IS NULL OR v_setting_key NOT IN ('avoidedColors', 'avoidedPatterns', 'avoidedFits', 'preferredColors', 'preferredFits', 'preferredSilhouettes', 'maxDailyFormality') THEN
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_key'));
        CONTINUE;
      END IF;

      IF v_action NOT IN ('set', 'update', 'clear') THEN
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_action'));
        CONTINUE;
      END IF;

      -- Semantic value typing per setting_key
      IF v_action IN ('set', 'update') THEN
        IF v_setting_key IN ('avoidedColors', 'preferredColors', 'avoidedPatterns') THEN
          IF v_setting_val IS NULL OR pg_catalog.jsonb_typeof(v_setting_val) <> 'array' 
             OR pg_catalog.jsonb_array_length(v_setting_val) > 20 THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_value_array'));
            CONTINUE;
          END IF;
          FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_setting_val)
          LOOP
            IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR pg_catalog.length(v_arr_elem#>>'{}') > 32 THEN
              v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
                pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_element_string'));
              GOTO next_event;
            END IF;
          END LOOP;
        ELSIF v_setting_key IN ('avoidedFits', 'preferredFits', 'preferredSilhouettes') THEN
          IF v_setting_val IS NULL OR pg_catalog.jsonb_typeof(v_setting_val) <> 'array' 
             OR pg_catalog.jsonb_array_length(v_setting_val) > 10 THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_value_array'));
            CONTINUE;
          END IF;
          FOR v_arr_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_setting_val)
          LOOP
            IF pg_catalog.jsonb_typeof(v_arr_elem) <> 'string' OR pg_catalog.length(v_arr_elem#>>'{}') > 32 THEN
              v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
                pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_setting_element_string'));
              GOTO next_event;
            END IF;
          END LOOP;
        ELSIF v_setting_key = 'maxDailyFormality' THEN
          IF v_setting_val IS NULL OR pg_catalog.jsonb_typeof(v_setting_val) <> 'string'
             OR v_setting_val#>>'{}' NOT IN ('casual', 'smart_casual', 'business_casual', 'business_formal', 'black_tie') THEN
            v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
              pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_formality_enum'));
            CONTINUE;
          END IF;
        END IF;
      ELSIF v_action = 'clear' THEN
        v_setting_val := 'null'::jsonb;
      END IF;

      v_server_weight := 0.00;
      v_sanitized_payload := pg_catalog.jsonb_build_object(
        'action', v_action,
        'setting_key', v_setting_key,
        'setting_value', v_setting_val
      );

    ELSIF v_event_type = 'reset_learned_preferences' THEN
      FOR v_key IN SELECT pg_catalog.jsonb_object_keys(v_payload)
      LOOP
        IF v_key NOT IN ('reset_scope') THEN
          v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
            pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'unknown_payload_key_' || v_key));
          GOTO next_event;
        END IF;
      END LOOP;

      IF (v_payload->>'reset_scope') <> 'learned_only' THEN
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_reset_scope'));
        CONTINUE;
      END IF;
      v_server_weight := 0.00;
      v_sanitized_payload := v_payload;

    ELSE
      v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
        pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_event_type'));
      CONTINUE;
    END IF;

    -- 5. Race-Safe Atomic Insert with Conflict Handling
    INSERT INTO public.style_preference_events (
      id, user_id, event_schema_version, event_type, preference_action_id, signal_weight, payload, client_timestamp, created_at
    ) VALUES (
      v_event_id, v_user_id, v_schema_version, v_event_type, v_action_id, v_server_weight, v_sanitized_payload, v_client_ts, v_now
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NOT NULL THEN
      -- Newly inserted unique event
      v_accepted_ids := pg_catalog.array_append(v_accepted_ids, v_event_id);
      v_newly_inserted_count := v_newly_inserted_count + 1;
    ELSE
      -- Conflict occurred: safely verify owner
      SELECT spe.user_id INTO v_existing_owner
      FROM public.style_preference_events spe
      WHERE spe.id = v_event_id;

      IF v_existing_owner = v_user_id THEN
        v_duplicate_ids := pg_catalog.array_append(v_duplicate_ids, v_event_id);
      ELSE
        -- Cross-user collision: reject as invalid_id without revealing owner
        v_rejected_ids := pg_catalog.array_append(v_rejected_ids, 
          pg_catalog.jsonb_build_object('id', v_event_id, 'reason', 'invalid_id'));
      END IF;
    END IF;

    <<next_event>>
    NULL;
  END LOOP;

  -- 6. Trigger Internal Aggregator
  PERFORM public.aggregate_user_style_dna(v_user_id, v_now);

  -- 7. Retrieve Final Materialized Profile
  SELECT * INTO v_profile FROM public.user_style_profiles usp WHERE usp.user_id = v_user_id;

  -- 8. Response Contract
  v_result := pg_catalog.jsonb_build_object(
    'accepted_ids', pg_catalog.to_jsonb(v_accepted_ids),
    'duplicate_ids', pg_catalog.to_jsonb(v_duplicate_ids),
    'rejected_ids', pg_catalog.to_jsonb(v_rejected_ids),
    'profile', pg_catalog.to_jsonb(v_profile),
    'server_time', v_now,
    'schema_version', 1
  );

  RETURN v_result;
END;
$$;

-- Privileges: authenticated only
REVOKE ALL ON FUNCTION public.sync_and_aggregate_style_dna(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_and_aggregate_style_dna(JSONB) TO authenticated;

-- ============================================================================
-- Security Definer RPC: refresh_style_profile
-- Description: Re-aggregates profile if stale (> 7 days) or p_force = true.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_style_profile(
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_computed_at TIMESTAMPTZ;
  v_profile RECORD;
BEGIN
  -- 1. Authentication Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid user authentication required.';
  END IF;

  -- 2. Concurrency Control
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('style_dna_' || v_user_id::text));

  -- 3. Check Freshness
  SELECT usp.projection_computed_at INTO v_computed_at
  FROM public.user_style_profiles usp WHERE usp.user_id = v_user_id;

  -- Re-aggregate if never computed, forced, or stale > 7 days
  IF v_computed_at IS NULL OR p_force OR v_computed_at < (v_now - INTERVAL '7 days') THEN
    PERFORM public.aggregate_user_style_dna(v_user_id, v_now);
  END IF;

  -- 4. Return current profile
  SELECT * INTO v_profile FROM public.user_style_profiles usp WHERE usp.user_id = v_user_id;
  RETURN pg_catalog.to_jsonb(v_profile);
END;
$$;

-- Privileges: authenticated only
REVOKE ALL ON FUNCTION public.refresh_style_profile(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_style_profile(BOOLEAN) TO authenticated;
