-- Make date/time nullable for mobile phase 2

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
  v_canonical_terms_version text := 'v2026-09-pickup';
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
    -- Phase 2 new workflow: no explicit appointment time
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

  FOR v_item IN
    WITH raw AS (
      SELECT
        (entry.value->>'product_id')::uuid AS product_id,
        nullif(trim(entry.value->>'size'), '') AS size,
        nullif(trim(entry.value->>'color'), '') AS color,
        (entry.value->>'quantity')::integer AS qty
      FROM jsonb_array_elements(_items) AS entry
    )
    SELECT r.*, p.name, p.price, p.status as p_status, p.stock
    FROM raw r
    JOIN public.products p ON p.id = r.product_id
  LOOP
    IF v_item.p_status <> 'active' THEN
      RAISE EXCEPTION 'Product % is not available.', v_item.name;
    END IF;
    IF coalesce(v_item.stock, 0) < v_item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %.', v_item.name;
    END IF;

    v_total := v_total + (v_item.price * v_item.qty);
    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_item.product_id,
      'product_name', v_item.name,
      'size', v_item.size,
      'color', v_item.color,
      'quantity', v_item.qty,
      'unit_price', v_item.price,
      'image_url', (SELECT image_url FROM public.product_images WHERE product_id = v_item.product_id ORDER BY display_order ASC LIMIT 1)
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

REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.create_reservation_multi_idempotent(
  _idempotency_key uuid,
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

  -- Staff transactional isolation
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.reservations
  WHERE idempotency_key = _idempotency_key
    AND customer_id = v_user_id
  LIMIT 1;

  IF FOUND THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'product_id', product_id,
        'product_name', product_name,
        'size', size,
        'color', color,
        'quantity', quantity,
        'unit_price', unit_price,
        'image_url', image_url
      )
    ) INTO v_items
    FROM public.reservation_items
    WHERE reservation_id = v_existing.id;

    IF (nullif(_date, '') IS NULL) AND (nullif(_appointment_time, '') IS NULL) THEN
      v_appointment := NULL;
    ELSE
      v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';
    END IF;

    -- Rough payload consistency check
    v_payload_mismatch := (
      (v_appointment IS DISTINCT FROM v_existing.appointment_time) OR
      (nullif(_receipt_path, '') IS DISTINCT FROM v_existing.receipt_url) OR
      (v_payment_type IS DISTINCT FROM v_existing.payment_type)
    );

    IF v_payload_mismatch THEN
      RAISE EXCEPTION 'Idempotency key % already used with a different reservation payload.', _idempotency_key;
    END IF;

    v_result := to_jsonb(v_existing) || jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
    RETURN v_result;
  END IF;

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
  WHERE id = (v_result->>'id')::uuid;

  v_result := v_result || jsonb_build_object('idempotency_key', _idempotency_key);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid, text) TO authenticated;
