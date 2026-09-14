-- Migration: 20260915071500_harden_idempotent_reservation_staff_isolation.sql
-- Description: Enforce staff transactional isolation (42501) on create_reservation_multi
-- and create_reservation_multi_idempotent to close the staff reservation bypass.

CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL::text,
  _payment_option text DEFAULT 'deposit'::text,
  _customer_id uuid DEFAULT NULL::uuid
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
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_appointment timestamptz;
  v_payment_due_at timestamptz;
  v_manual_max_minutes integer;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
  v_item jsonb;
  v_quantity integer;
  v_total numeric := 0;
  v_deposit numeric;
  v_line_count integer;
  v_first jsonb;
  v_items_resolved jsonb := '[]'::jsonb;
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
  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  v_manual_max_minutes := coalesce(
    (SELECT (value->>'manual_max_minutes')::integer FROM public.settings WHERE key = 'reservationPaymentWindow'),
    120
  );
  v_payment_due_at := LEAST(v_appointment - interval '30 minutes', now() + make_interval(mins => v_manual_max_minutes));
  IF v_payment_due_at < now() + interval '90 minutes' THEN
    v_payment_due_at := LEAST(now() + interval '90 minutes', v_appointment);
  END IF;

  FOR v_item IN
    WITH raw AS (
      SELECT
        (entry.value->>'product_id')::uuid AS product_id,
        nullif(trim(entry.value->>'size'), '') AS size,
        nullif(trim(entry.value->>'color'), '') AS color,
        coalesce((entry.value->>'quantity')::integer, 1) AS quantity
      FROM jsonb_array_elements(_items) entry
    )
    SELECT jsonb_build_object(
      'product_id', product_id,
      'size', size,
      'color', color,
      'quantity', sum(quantity)::integer
    )
    FROM raw
    GROUP BY product_id, size, color
    ORDER BY product_id, size, color
  LOOP
    v_quantity := (v_item->>'quantity')::integer;

    SELECT p.id, p.name, p.image_url,
      CASE
        WHEN coalesce(p.on_sale, false) AND p.sale_price IS NOT NULL AND p.sale_price > 0
          THEN p.sale_price
        ELSE coalesce(p.price, 0)
      END::numeric AS price
    INTO v_product
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid
      AND p.visibility = 'public'
      AND coalesce(p.deleted, false) = false
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One of the selected products is unavailable.';
    END IF;
    IF v_product.price <= 0 THEN
      RAISE EXCEPTION 'One of the selected products has an invalid price.';
    END IF;

    v_total := v_total + (v_product.price * v_quantity);
    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'image_url', v_product.image_url,
      'size', v_item->>'size',
      'color', v_item->>'color',
      'quantity', v_quantity,
      'unit_price', v_product.price
    );
  END LOOP;

  IF v_option = 'full' THEN
    v_deposit := round(v_total, 2);
    v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_total * 0.5, 2);
    v_payment_type := 'Deposit';
  END IF;

  SELECT p.first_name, p.last_name
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_user_id
    AND p.role = 'customer'
    AND coalesce(p.deleted, false) = false
    AND coalesce(p.is_blocked, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer account is unavailable.';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
      || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.display_id = v_display_id);
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate reservation number.';
    END IF;
  END LOOP;

  v_first := v_items_resolved -> 0;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at,
    purchase_mode, sales_channel
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
    _date::date,
    NULL,
    v_appointment,
    nullif(_receipt_path, ''),
    'To Pay',
    'Pending',
    v_payment_type,
    v_payment_due_at,
    'reservation', 'mobile'
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price
  )
  SELECT
    v_reservation.id,
    (line->>'product_id')::uuid,
    line->>'product_name',
    line->>'image_url',
    line->>'size',
    line->>'color',
    (line->>'quantity')::integer,
    (line->>'unit_price')::numeric
  FROM jsonb_array_elements(v_items_resolved) line;

  RETURN to_jsonb(v_reservation) || jsonb_build_object('items', v_items_resolved);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_reservation_multi_idempotent(
  _idempotency_key uuid,
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL::text,
  _payment_option text DEFAULT 'deposit'::text,
  _customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_user_id uuid;
  v_existing public.reservations%rowtype;
  v_result jsonb;
  v_items jsonb;
  v_appointment timestamptz;
  v_payment_type text := CASE lower(coalesce(_payment_option, 'deposit'))
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

  -- Staff transactional isolation: reject staff/admin/owner customer reservations
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_idempotency_key::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.reservations
  WHERE idempotency_key = _idempotency_key;

  IF FOUND THEN
    v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

    WITH requested AS (
      SELECT
        (entry.value->>'product_id')::uuid AS product_id,
        nullif(trim(entry.value->>'size'), '') AS size,
        nullif(trim(entry.value->>'color'), '') AS color,
        sum(coalesce((entry.value->>'quantity')::integer, 1))::integer AS quantity
      FROM jsonb_array_elements(_items) entry
      GROUP BY 1, 2, 3
    ), existing AS (
      SELECT
        ri.product_id,
        nullif(trim(ri.size), '') AS size,
        nullif(trim(ri.color), '') AS color,
        sum(ri.quantity)::integer AS quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = v_existing.id
      GROUP BY 1, 2, 3
    ), differences AS (
      (SELECT * FROM requested EXCEPT SELECT * FROM existing)
      UNION ALL
      (SELECT * FROM existing EXCEPT SELECT * FROM requested)
    )
    SELECT EXISTS (SELECT 1 FROM differences) INTO v_payload_mismatch;

    IF v_existing.customer_id IS DISTINCT FROM v_user_id
       OR v_existing.date IS DISTINCT FROM _date::date
       OR v_existing.appointment_time IS DISTINCT FROM v_appointment
       OR v_existing.payment_type IS DISTINCT FROM v_payment_type
       OR v_payload_mismatch THEN
      RAISE EXCEPTION 'Idempotency key reuse with different reservation details.';
    END IF;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', ri.product_id,
          'product_name', ri.product_name,
          'image_url', ri.image_url,
          'size', ri.size,
          'color', ri.color,
          'quantity', ri.quantity,
          'unit_price', ri.unit_price
        ) ORDER BY ri.product_id, ri.size, ri.color
      ),
      '[]'::jsonb
    ) INTO v_items
    FROM public.reservation_items ri
    WHERE ri.reservation_id = v_existing.id;

    RETURN to_jsonb(v_existing) || jsonb_build_object('items', v_items);
  END IF;

  v_result := public.create_reservation_multi(
    _items,
    _date,
    _appointment_time,
    _receipt_path,
    _payment_option,
    _customer_id
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
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid) TO authenticated;
