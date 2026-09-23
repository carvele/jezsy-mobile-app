-- =============================================================================
-- Migration: 20260923230000_canonical_reservation_variant_identity.sql
--
-- Canonical Reservation Variant Identity Repair:
--   1. Updates resolve_reservation_item_inventory_variant trigger:
--      - When NEW.inventory_id is supplied, validates that it exists, belongs to
--        NEW.product_id, and is active (deleted = false). Canonicalizes NEW.size
--        and NEW.color directly from the inventory row.
--      - When NEW.inventory_id is NULL (legacy clients), matches by normalized
--        size and color, with single-variant fallback for 1-of-1 products.
--   2. Updates create_reservation_multi:
--      - Accepts optional inventory_id per item in _items.
--      - Resolves and binds canonical inventory_id, size, and color.
--      - Explicitly inserts inventory_id into public.reservation_items.
--   3. Updates create_reservation_multi_idempotent:
--      - Robust idempotency replay comparison matching on canonical inventory_id.
--      - Returns items with inventory_id populated on replay.
-- =============================================================================

-- 1. Trigger Function: resolve_reservation_item_inventory_variant
CREATE OR REPLACE FUNCTION public.resolve_reservation_item_inventory_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_inv record;
  v_matches uuid[];
BEGIN
  -- Direct canonical resolution: client or RPC provided explicit inventory_id
  IF NEW.inventory_id IS NOT NULL THEN
    SELECT i.id, i.size, i.color
    INTO v_inv
    FROM public.inventory i
    WHERE i.id = NEW.inventory_id
      AND i.product_doc_id = NEW.product_id
      AND coalesce(i.deleted, false) = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reservation inventory variant is invalid, deleted, or does not belong to product.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Canonicalize size and color from authoritative inventory variant
    NEW.size := v_inv.size;
    NEW.color := v_inv.color;
    RETURN NEW;
  END IF;

  -- Legacy fallback: resolve by product_id + size + color
  SELECT array_agg(i.id ORDER BY i.id)
  INTO v_matches
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND trim(lower(coalesce(i.size, ''))) = trim(lower(coalesce(NEW.size, '')))
    AND trim(lower(coalesce(i.color, ''))) = trim(lower(coalesce(NEW.color, '')))
    AND coalesce(i.deleted, false) = false;

  -- 1-of-1 product fallback when client did not provide matching size/color
  IF coalesce(array_length(v_matches, 1), 0) = 0 THEN
    SELECT array_agg(i.id ORDER BY i.id)
    INTO v_matches
    FROM public.inventory i
    WHERE i.product_doc_id = NEW.product_id
      AND coalesce(i.deleted, false) = false;
  END IF;

  IF coalesce(array_length(v_matches, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'Selected size and color do not identify one active inventory variant.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.id, i.size, i.color
  INTO v_inv
  FROM public.inventory i
  WHERE i.id = v_matches[1];

  NEW.inventory_id := v_inv.id;
  NEW.size := v_inv.size;
  NEW.color := v_inv.color;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_reservation_item_inventory_variant()
  FROM PUBLIC, anon, authenticated;


-- 2. Core RPC: create_reservation_multi
CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text DEFAULT NULL,
  _appointment_time text DEFAULT NULL,
  _receipt_path text DEFAULT NULL::text,
  _payment_option text DEFAULT 'deposit'::text,
  _customer_id uuid DEFAULT NULL::uuid,
  _pickup_terms_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_user_id uuid;
  v_profile record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_appointment timestamptz;
  v_payment_due_at timestamptz;
  v_manual_max_minutes integer;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
  v_item jsonb;
  v_total numeric := 0;
  v_deposit numeric;
  v_line_count integer;
  v_first jsonb;
  v_items_resolved jsonb := '[]'::jsonb;
  v_canonical_terms_version text := 'v2026-09-pickup';
  v_prod record;
  v_inv record;
  v_inv_matches uuid[];
  v_req_prod_id uuid;
  v_req_inv_id uuid;
  v_req_size text;
  v_req_color text;
  v_req_qty integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_user_id := coalesce(_customer_id, v_actor_id);
  IF _customer_id IS NOT NULL
     AND _customer_id <> v_actor_id
     AND NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  -- Staff transactional isolation: reject staff/admin/owner customer reservations
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  IF v_option NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A reservation must contain at least one item.';
  END IF;

  v_line_count := jsonb_array_length(_items);
  IF v_line_count > 20 THEN
    RAISE EXCEPTION 'A reservation cannot contain more than 20 items.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    IF coalesce((v_item->>'quantity')::integer, 1) < 1 THEN
      RAISE EXCEPTION 'Quantity must be positive.';
    END IF;
    IF nullif(v_item->>'product_id', '') IS NULL THEN
      RAISE EXCEPTION 'Every reservation item needs a product.';
    END IF;
  END LOOP;

  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;

  IF (nullif(_date, '') IS NULL) AND (nullif(_appointment_time, '') IS NULL) THEN
    -- Phase 2 workflow: no explicit appointment time
    v_appointment := NULL;
  ELSIF (nullif(_date, '') IS NOT NULL) AND (nullif(_appointment_time, '') IS NOT NULL) THEN
    -- Legacy workflow: both provided
    v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';
  ELSE
    RAISE EXCEPTION 'Both date and time must be provided, or both must be empty.';
  END IF;

  v_manual_max_minutes := coalesce(
    (SELECT (value->>'manual_max_minutes')::integer FROM public.settings WHERE key = 'reservationPaymentWindow'),
    120
  );

  IF v_appointment IS NOT NULL THEN
    v_payment_due_at := LEAST(v_appointment - interval '30 minutes', now() + make_interval(mins => v_manual_max_minutes));
    IF v_payment_due_at < now() + interval '90 minutes' THEN
      v_payment_due_at := LEAST(now() + interval '90 minutes', v_appointment);
    END IF;
  ELSE
    v_payment_due_at := now() + make_interval(mins => v_manual_max_minutes);
  END IF;

  -- Resolve items and authoritative variants
  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    v_req_prod_id := (v_item->>'product_id')::uuid;
    v_req_inv_id  := nullif(trim(v_item->>'inventory_id'), '')::uuid;
    v_req_size    := nullif(trim(v_item->>'size'), '');
    v_req_color   := nullif(trim(v_item->>'color'), '');
    v_req_qty     := coalesce((v_item->>'quantity')::integer, 1);

    SELECT * INTO v_prod FROM public.products WHERE id = v_req_prod_id;
    IF NOT FOUND OR v_prod.deleted THEN
      RAISE EXCEPTION 'Product % is not available.', coalesce(v_prod.name, v_req_prod_id::text);
    END IF;
    IF v_prod.status <> 'active' THEN
      RAISE EXCEPTION 'Product % is not available.', v_prod.name;
    END IF;

    -- Resolve canonical inventory row
    IF v_req_inv_id IS NOT NULL THEN
      SELECT * INTO v_inv
      FROM public.inventory
      WHERE id = v_req_inv_id
        AND product_doc_id = v_req_prod_id
        AND coalesce(deleted, false) = false;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The selected inventory variant is no longer active for %.', v_prod.name
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      -- Match by size and color
      SELECT array_agg(i.id ORDER BY i.id) INTO v_inv_matches
      FROM public.inventory i
      WHERE i.product_doc_id = v_req_prod_id
        AND trim(lower(coalesce(i.size, ''))) = trim(lower(coalesce(v_req_size, '')))
        AND trim(lower(coalesce(i.color, ''))) = trim(lower(coalesce(v_req_color, '')))
        AND coalesce(i.deleted, false) = false;

      -- 1-of-1 product fallback
      IF coalesce(array_length(v_inv_matches, 1), 0) = 0 THEN
        SELECT array_agg(i.id ORDER BY i.id) INTO v_inv_matches
        FROM public.inventory i
        WHERE i.product_doc_id = v_req_prod_id
          AND coalesce(i.deleted, false) = false;
      END IF;

      IF coalesce(array_length(v_inv_matches, 1), 0) <> 1 THEN
        RAISE EXCEPTION 'Selected size and color do not identify one active inventory variant for %.', v_prod.name
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT * INTO v_inv FROM public.inventory WHERE id = v_inv_matches[1];
    END IF;

    IF coalesce(v_inv.available, 0) < v_req_qty THEN
      RAISE EXCEPTION 'Only % unit(s) remain for the selected variant.', coalesce(v_inv.available, 0)
        USING ERRCODE = 'check_violation';
    END IF;

    v_total := v_total + (v_prod.price * v_req_qty);
    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_prod.id,
      'product_name', v_prod.name,
      'size', v_inv.size,
      'color', v_inv.color,
      'quantity', v_req_qty,
      'unit_price', v_prod.price,
      'inventory_id', v_inv.id,
      'image_url', (SELECT image_url FROM public.product_images WHERE product_id = v_prod.id ORDER BY display_order ASC LIMIT 1)
    );
  END LOOP;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;

  LOOP
    v_display_id := 'RES-' || upper(substr(md5(random()::text), 1, 8));
    BEGIN
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 5 THEN RAISE EXCEPTION 'Could not generate unique ID.'; END IF;
    END;
  END LOOP;

  v_payment_type := CASE v_option WHEN 'full' THEN 'Full' ELSE 'Deposit' END;
  IF v_option = 'full' THEN
    v_deposit := round(v_total, 2);
  ELSE
    v_deposit := round(v_total * 0.5, 2);
  END IF;

  v_first := v_items_resolved -> 0;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at, countdown,
    purchase_mode, sales_channel, pickup_terms_version, pickup_terms_accepted_at
  ) VALUES (
    v_display_id,
    v_user_id,
    coalesce(nullif(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    (v_first->>'product_id')::uuid,
    v_first->>'product_name',
    v_first->>'image_url',
    v_first->>'size',
    v_first->>'color',
    (v_first->>'quantity')::integer,
    round(v_total, 2),
    v_deposit,
    NULLIF(_date, '')::date,
    NULL,
    v_appointment,
    nullif(_receipt_path, ''),
    'To Pay',
    'Pending',
    v_payment_type,
    v_payment_due_at,
    true,
    'reservation', 'mobile',
    CASE WHEN nullif(_pickup_terms_version, '') IS NOT NULL THEN v_canonical_terms_version ELSE NULL END,
    CASE WHEN nullif(_pickup_terms_version, '') IS NOT NULL THEN now() ELSE NULL END
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price, inventory_id
  )
  SELECT
    v_reservation.id,
    (line->>'product_id')::uuid,
    line->>'product_name',
    line->>'image_url',
    line->>'size',
    line->>'color',
    (line->>'quantity')::integer,
    (line->>'unit_price')::numeric,
    (line->>'inventory_id')::uuid
  FROM jsonb_array_elements(v_items_resolved) line;

  RETURN to_jsonb(v_reservation) || jsonb_build_object('items', v_items_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) TO authenticated;


-- 3. Idempotent Wrapper: create_reservation_multi_idempotent
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
    WITH requested_raw AS (
      SELECT
        (entry.value->>'product_id')::uuid AS product_id,
        nullif(trim(entry.value->>'inventory_id'), '')::uuid AS inventory_id,
        nullif(trim(entry.value->>'size'), '') AS size,
        nullif(trim(entry.value->>'color'), '') AS color,
        coalesce((entry.value->>'quantity')::integer, 1) AS quantity
      FROM jsonb_array_elements(_items) entry
    ),
    requested AS (
      SELECT
        r.product_id,
        coalesce(r.inventory_id, i.id) AS inventory_id,
        coalesce(i.size, r.size) AS size,
        coalesce(i.color, r.color) AS color,
        sum(r.quantity)::integer AS quantity
      FROM requested_raw r
      LEFT JOIN public.inventory i ON (
        (r.inventory_id IS NOT NULL AND i.id = r.inventory_id)
        OR
        (r.inventory_id IS NULL AND i.product_doc_id = r.product_id
         AND trim(lower(coalesce(i.size, ''))) = trim(lower(coalesce(r.size, '')))
         AND trim(lower(coalesce(i.color, ''))) = trim(lower(coalesce(r.color, '')))
         AND coalesce(i.deleted, false) = false)
      )
      GROUP BY 1, 2, 3, 4
    ),
    existing_items AS (
      SELECT
        ri.product_id,
        ri.inventory_id,
        nullif(trim(ri.size), '') AS size,
        nullif(trim(ri.color), '') AS color,
        sum(ri.quantity)::integer AS quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = v_existing.id
      GROUP BY 1, 2, 3, 4
    ),
    differences AS (
      (SELECT product_id, inventory_id, size, color, quantity FROM requested
       EXCEPT
       SELECT product_id, inventory_id, size, color, quantity FROM existing_items)
      UNION ALL
      (SELECT product_id, inventory_id, size, color, quantity FROM existing_items
       EXCEPT
       SELECT product_id, inventory_id, size, color, quantity FROM requested)
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
          'unit_price',   ri.unit_price,
          'inventory_id', ri.inventory_id
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
