-- Give mobile reservation creation a retry-safe command boundary without
-- replacing the established inventory-hold implementation.
CREATE OR REPLACE FUNCTION public.create_reservation_multi_idempotent(
  _idempotency_key uuid,
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL,
  _payment_option text DEFAULT 'deposit',
  _customer_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
     AND NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;

  -- Serialize retries for this command even when the first request is still
  -- running. The unique column remains the durable backstop after commit.
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
$$;

REVOKE ALL ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi_idempotent(uuid, jsonb, text, text, text, text, uuid)
  TO authenticated;
