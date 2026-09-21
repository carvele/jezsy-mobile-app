-- =============================================================================
-- 20260921120000_phase2_idempotent_wrapper.sql
--
-- Brings create_reservation_multi_idempotent in line with the Phase 2
-- signature introduced in 20260920140104_phase2_create_reservation.sql:
--
--   1. _date and _appointment_time are now optional (DEFAULT NULL) so the
--      no-appointment pickup flow works end-to-end.
--
--   2. Adds _pickup_terms_version (DEFAULT NULL) forwarded through to
--      create_reservation_multi, which requires it for the no-date path.
--
--   3. Idempotency replay path now handles NULL date/time without casting.
--
-- The old 7-argument overload (required _date, required _appointment_time,
-- no _pickup_terms_version) is dropped first to avoid ambiguous overload
-- resolution when Postgres sees an 8-argument call from the mobile client.
--
-- Idempotent: DROP IF EXISTS + CREATE OR REPLACE pattern.
-- No schema changes.
-- =============================================================================

-- Drop the now-superseded 7-arg overload so the new 8-arg signature is
-- the sole target and Postgres cannot route calls to the stale version.
DROP FUNCTION IF EXISTS public.create_reservation_multi_idempotent(
  uuid, jsonb, text, text, text, text, uuid
);

CREATE OR REPLACE FUNCTION public.create_reservation_multi_idempotent(
  _idempotency_key      uuid,
  _items                jsonb,
  _date                 text    DEFAULT NULL,
  _appointment_time     text    DEFAULT NULL,
  _receipt_path         text    DEFAULT NULL,
  _payment_option       text    DEFAULT 'deposit',
  _customer_id          uuid    DEFAULT NULL,
  _pickup_terms_version text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actor_id        uuid := auth.uid();
  v_user_id         uuid;
  v_existing        public.reservations%rowtype;
  v_result          jsonb;
  v_items           jsonb;
  v_appointment     timestamptz;
  v_payment_type    text := CASE lower(coalesce(_payment_option, 'deposit'))
                              WHEN 'full' THEN 'Full'
                              ELSE 'Deposit'
                            END;
  v_payload_mismatch boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.';
  END IF;
  IF lower(coalesce(_payment_option, 'deposit')) NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A reservation must contain at least one item.';
  END IF;

  v_user_id := coalesce(_customer_id, v_actor_id);
  IF _customer_id IS NOT NULL
     AND _customer_id <> v_actor_id
     AND NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  -- Staff transactional isolation.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent retries for the same idempotency key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_idempotency_key::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.reservations
  WHERE idempotency_key = _idempotency_key;

  IF FOUND THEN
    -- Replay path: compute appointment only when date+time are both present.
    IF nullif(_date, '') IS NOT NULL AND nullif(_appointment_time, '') IS NOT NULL THEN
      v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';
    ELSE
      v_appointment := NULL;
    END IF;

    -- Verify the replayed call matches the original.
    WITH requested AS (
      SELECT
        (entry.value->>'product_id')::uuid                         AS product_id,
        nullif(trim(entry.value->>'size'), '')                     AS size,
        nullif(trim(entry.value->>'color'), '')                    AS color,
        sum(coalesce((entry.value->>'quantity')::integer, 1))::integer AS quantity
      FROM jsonb_array_elements(_items) entry
      GROUP BY 1, 2, 3
    ), existing_items AS (
      SELECT
        ri.product_id,
        nullif(trim(ri.size), '')  AS size,
        nullif(trim(ri.color), '') AS color,
        sum(ri.quantity)::integer  AS quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = v_existing.id
      GROUP BY 1, 2, 3
    ), differences AS (
      (SELECT * FROM requested EXCEPT SELECT * FROM existing_items)
      UNION ALL
      (SELECT * FROM existing_items EXCEPT SELECT * FROM requested)
    )
    SELECT EXISTS (SELECT 1 FROM differences) INTO v_payload_mismatch;

    IF v_existing.customer_id IS DISTINCT FROM v_user_id
       OR v_existing.date IS DISTINCT FROM nullif(_date, '')::date
       OR v_existing.appointment_time IS DISTINCT FROM v_appointment
       OR v_existing.payment_type IS DISTINCT FROM v_payment_type
       OR v_payload_mismatch THEN
      RAISE EXCEPTION 'Idempotency key reuse with different reservation details.';
    END IF;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id',   ri.product_id,
          'product_name', ri.product_name,
          'image_url',    ri.image_url,
          'size',         ri.size,
          'color',        ri.color,
          'quantity',     ri.quantity,
          'unit_price',   ri.unit_price
        ) ORDER BY ri.product_id, ri.size, ri.color
      ),
      '[]'::jsonb
    ) INTO v_items
    FROM public.reservation_items ri
    WHERE ri.reservation_id = v_existing.id;

    RETURN to_jsonb(v_existing) || jsonb_build_object('items', v_items);
  END IF;

  -- First-time path: delegate to create_reservation_multi.
  v_result := public.create_reservation_multi(
    _items,
    _date,
    _appointment_time,
    _receipt_path,
    _payment_option,
    _customer_id,
    _pickup_terms_version
  );

  UPDATE public.reservations
  SET idempotency_key = _idempotency_key
  WHERE id = (v_result->>'id')::uuid
    AND customer_id = v_user_id
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not attach the reservation idempotency key.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotency_key', _idempotency_key);
END;
$$;

REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid, text)
  TO authenticated;
