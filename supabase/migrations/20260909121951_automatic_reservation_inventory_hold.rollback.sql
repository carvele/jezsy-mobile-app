-- Restore the approval-gated reservation flow and parent-based reconciliation.

DROP TRIGGER IF EXISTS trg_00_lock_reservation_capacity_day ON public.reservations;
DROP FUNCTION IF EXISTS public.lock_reservation_capacity_day();
DROP TRIGGER IF EXISTS trg_guard_held_reservation_item_update ON public.reservation_items;
DROP FUNCTION IF EXISTS public.guard_held_reservation_item_update();
DROP FUNCTION IF EXISTS public.create_reservation_multi(jsonb, text, text, text, text, uuid);

ALTER TABLE public.reservation_items
  DROP CONSTRAINT IF EXISTS reservation_items_inventory_required;
DROP INDEX IF EXISTS public.reservation_items_one_variant_per_reservation;

CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL,
  _payment_option text DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_appointment timestamptz;
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
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
  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;
  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    v_quantity := coalesce((v_item->>'quantity')::integer, 1);
    IF v_quantity < 1 THEN RAISE EXCEPTION 'Quantity must be positive.'; END IF;

    SELECT p.id, p.name, p.image_url,
      CASE WHEN coalesce(p.on_sale, false) AND p.sale_price IS NOT NULL AND p.sale_price > 0
        THEN p.sale_price ELSE coalesce(p.price, 0) END::numeric AS price
    INTO v_product
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid
      AND p.visibility = 'public'
      AND coalesce(p.deleted, false) = false
    FOR SHARE;

    IF NOT FOUND THEN RAISE EXCEPTION 'One of the selected products is unavailable.'; END IF;
    IF v_product.price <= 0 THEN RAISE EXCEPTION 'One of the selected products has an invalid price.'; END IF;

    v_total := v_total + (v_product.price * v_quantity);
    v_items_resolved := v_items_resolved || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'image_url', v_product.image_url,
      'size', nullif(v_item->>'size', ''),
      'color', nullif(v_item->>'color', ''),
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

  SELECT p.first_name, p.last_name INTO v_profile
  FROM public.profiles p WHERE p.id = v_user_id;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
      || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.display_id = v_display_id);
    IF v_attempt > 10 THEN RAISE EXCEPTION 'Could not allocate reservation number.'; END IF;
  END LOOP;

  v_first := v_items_resolved -> 0;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, return_date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at
  ) VALUES (
    v_display_id, v_user_id,
    coalesce(nullif(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    (v_first->>'product_id')::uuid, v_first->>'product_name', v_first->>'image_url',
    v_first->>'size', v_first->>'color', (v_first->>'quantity')::integer,
    round(v_total, 2), v_deposit,
    _date::date, (_date::date + 4), v_appointment,
    nullif(_receipt_path, ''), 'Pending', 'Pending', v_payment_type, NULL
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

REVOKE EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_reservation_item_inventory_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inventory_id uuid;
BEGIN
  IF NEW.inventory_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT i.id INTO v_inventory_id
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND coalesce(i.size, '') = coalesce(NEW.size, '')
    AND coalesce(i.color, '') = coalesce(NEW.color, '')
    AND coalesce(i.deleted, false) = false
  LIMIT 2;
  IF v_inventory_id IS NULL OR 1 <> (
    SELECT count(*) FROM public.inventory i
    WHERE i.product_doc_id = NEW.product_id
      AND coalesce(i.size, '') = coalesce(NEW.size, '')
      AND coalesce(i.color, '') = coalesce(NEW.color, '')
      AND coalesce(i.deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Selected size and color do not identify one active inventory variant.';
  END IF;
  NEW.inventory_id := v_inventory_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.hold_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_deleted boolean;
  v_available integer;
  v_product_name text;
BEGIN
  SELECT r.status, coalesce(r.deleted, false) INTO v_status, v_deleted
  FROM public.reservations r WHERE r.id = NEW.reservation_id;
  IF NOT public.reservation_holds_stock(v_status, v_deleted) THEN RETURN NEW; END IF;

  SELECT i.available INTO v_available
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND i.size IS NOT DISTINCT FROM NEW.size
    AND i.color IS NOT DISTINCT FROM coalesce(NEW.color, '')
    AND i.deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_available < NEW.quantity THEN
    SELECT p.name INTO v_product_name FROM public.products p WHERE p.id = NEW.product_id;
    RAISE EXCEPTION 'Only % left of % (size %, color %).',
      v_available, coalesce(v_product_name, 'this item'),
      coalesce(NEW.size, 'one size'), coalesce(NEW.color, 'default')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory
  SET available = available - NEW.quantity,
      reserved = coalesce(reserved, 0) + NEW.quantity
  WHERE product_doc_id = NEW.product_id
    AND size IS NOT DISTINCT FROM NEW.size
    AND color IS NOT DISTINCT FROM coalesce(NEW.color, '')
    AND deleted = false;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_on_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_was boolean;
  v_now boolean;
  v_short record;
BEGIN
  v_was := public.reservation_holds_stock(OLD.status, OLD.deleted);
  v_now := public.reservation_holds_stock(NEW.status, NEW.deleted);
  IF v_was = v_now THEN RETURN NEW; END IF;

  IF v_was AND NOT v_now THEN
    IF lower(coalesce(NEW.status, '')) = 'completed' AND NOT coalesce(NEW.deleted, false) THEN
      UPDATE public.inventory i
      SET reserved = greatest(coalesce(i.reserved, 0) - ri.quantity, 0),
          total = greatest(coalesce(i.total, 0) - ri.quantity, 0)
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.color IS NOT DISTINCT FROM coalesce(ri.color, '')
        AND i.deleted = false;
    ELSE
      UPDATE public.inventory i
      SET reserved = greatest(coalesce(i.reserved, 0) - ri.quantity, 0),
          available = coalesce(i.available, 0) + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.color IS NOT DISTINCT FROM coalesce(ri.color, '')
        AND i.deleted = false;
    END IF;
  ELSE
    IF lower(coalesce(OLD.status, '')) = 'completed' THEN
      RAISE EXCEPTION 'A completed pickup cannot be reopened; adjust inventory manually instead.'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT ri.size, ri.color, i.available INTO v_short
    FROM public.reservation_items ri
    JOIN public.inventory i
      ON i.product_doc_id = ri.product_id
     AND i.size IS NOT DISTINCT FROM ri.size
     AND i.color IS NOT DISTINCT FROM coalesce(ri.color, '')
     AND i.deleted = false
    WHERE ri.reservation_id = NEW.id AND i.available < ri.quantity
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Cannot reactivate this reservation: only % left of size % (color %).',
        v_short.available, coalesce(v_short.size, 'one size'), coalesce(v_short.color, 'default')
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.inventory i
    SET available = coalesce(i.available, 0) - ri.quantity,
        reserved = coalesce(i.reserved, 0) + ri.quantity
    FROM public.reservation_items ri
    WHERE ri.reservation_id = NEW.id
      AND i.product_doc_id = ri.product_id
      AND i.size IS NOT DISTINCT FROM ri.size
      AND i.color IS NOT DISTINCT FROM coalesce(ri.color, '')
      AND i.deleted = false;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_deleted boolean;
BEGIN
  SELECT r.status, coalesce(r.deleted, false) INTO v_status, v_deleted
  FROM public.reservations r WHERE r.id = OLD.reservation_id;
  IF NOT FOUND OR NOT public.reservation_holds_stock(v_status, v_deleted) THEN RETURN OLD; END IF;
  UPDATE public.inventory
  SET reserved = greatest(coalesce(reserved, 0) - OLD.quantity, 0),
      available = coalesce(available, 0) + OLD.quantity
  WHERE product_doc_id = OLD.product_id
    AND size IS NOT DISTINCT FROM OLD.size
    AND color IS NOT DISTINCT FROM coalesce(OLD.color, '')
    AND deleted = false;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_inventory_stock()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_inventory_count integer;
  v_product_count integer;
  v_now timestamptz := now();
BEGIN
  IF NOT public.can_manage_inventory() THEN
    RAISE EXCEPTION 'Inventory management access required.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Administrator')
  INTO v_actor_name FROM public.profiles p WHERE p.id = v_actor;

  WITH calculated AS (
    SELECT i.id, coalesce(sum(r.quantity), 0)::integer AS reserved
    FROM public.inventory i
    LEFT JOIN public.reservations r
      ON (r.product_id = i.product_doc_id OR r.product_id::text = i.sku OR r.product_name = i.item)
     AND r.size = i.size
     AND coalesce(r.color, '') = coalesce(i.color, '')
     AND r.status IN ('Approved','Confirmed','To Pay','Preparing','To Pickup','Fitting','Active','Ready')
     AND coalesce(r.deleted, false) = false
    WHERE coalesce(i.deleted, false) = false
    GROUP BY i.id
  ), updated AS (
    UPDATE public.inventory i
    SET reserved = c.reserved,
        available = greatest(0, coalesce(i.total, 0) - c.reserved),
        updated_at = v_now
    FROM calculated c
    WHERE i.id = c.id
    RETURNING i.id
  )
  SELECT count(*) INTO v_inventory_count FROM updated;

  WITH totals AS (
    SELECT i.product_doc_id,
      coalesce(sum(i.available), 0)::integer AS available,
      coalesce(sum(i.reserved), 0)::integer AS reserved
    FROM public.inventory i
    WHERE coalesce(i.deleted, false) = false AND i.product_doc_id IS NOT NULL
    GROUP BY i.product_doc_id
  ), updated AS (
    UPDATE public.products p
    SET stock = t.available,
        status = CASE WHEN t.available <= 0
          THEN CASE WHEN t.reserved > 0 THEN 'Reserved' ELSE 'Out of Stock' END
          ELSE 'In Boutique' END,
        updated_at = v_now
    FROM totals t WHERE p.id = t.product_doc_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_product_count FROM updated;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details, timestamp)
  VALUES (
    v_actor, coalesce(v_actor_name, 'Administrator'), 'Recalculated Inventory Stock',
    'system', 'inventory',
    jsonb_build_object('inventoryUpdated', v_inventory_count, 'productsUpdated', v_product_count),
    v_now
  );
  RETURN jsonb_build_object('inventory_rows', v_inventory_count, 'products', v_product_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hold_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_inventory_on_reservation_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_inventory_stock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_stock() TO authenticated;
