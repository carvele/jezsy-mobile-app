-- Make a customer reservation an immediate inventory hold. There is no
-- administrator acceptance step in the hold-to-purchase business model.

-- Serialize capacity checks for one boutique day. The existing validator
-- counts first and inserts later; without this transaction lock, concurrent
-- customers can both observe the final open slot. A date-level lock also
-- protects the configured daily booking ceiling.
CREATE OR REPLACE FUNCTION public.lock_reservation_capacity_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_old_key text;
  v_new_key text;
BEGIN
  IF NEW.date IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_key := 'reservation-capacity:' || NEW.date::date::text;
  IF TG_OP = 'UPDATE' AND OLD.date IS NOT NULL AND OLD.date::date IS DISTINCT FROM NEW.date::date THEN
    v_old_key := 'reservation-capacity:' || OLD.date::date::text;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(least(v_old_key, v_new_key), 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(greatest(v_old_key, v_new_key), 0)
    );
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_new_key, 0));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_lock_reservation_capacity_day ON public.reservations;
CREATE TRIGGER trg_00_lock_reservation_capacity_day
BEFORE INSERT OR UPDATE OF date, appointment_time, status, deleted
ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.lock_reservation_capacity_day();

REVOKE EXECUTE ON FUNCTION public.lock_reservation_capacity_day()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.reservation_items
  ADD COLUMN IF NOT EXISTS inventory_id uuid;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservation_items_inventory_id_fkey'
      AND conrelid = 'public.reservation_items'::regclass
  ) THEN
    ALTER TABLE public.reservation_items
      ADD CONSTRAINT reservation_items_inventory_id_fkey
      FOREIGN KEY (inventory_id) REFERENCES public.inventory(id) ON DELETE RESTRICT;
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.resolve_reservation_item_inventory_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_matches uuid[];
BEGIN
  SELECT array_agg(i.id ORDER BY i.id)
  INTO v_matches
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND coalesce(i.size, '') = coalesce(NEW.size, '')
    AND coalesce(i.color, '') = coalesce(NEW.color, '')
    AND coalesce(i.deleted, false) = false;

  IF coalesce(array_length(v_matches, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'Selected size and color do not identify one active inventory variant.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.inventory_id IS NOT NULL AND NEW.inventory_id <> v_matches[1] THEN
    RAISE EXCEPTION 'Reservation inventory variant does not match its product, size, and color.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.inventory_id := v_matches[1];
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_reservation_items_resolve_inventory_variant ON public.reservation_items;
CREATE TRIGGER tr_reservation_items_resolve_inventory_variant
BEFORE INSERT OR UPDATE OF product_id, size, color, inventory_id
ON public.reservation_items
FOR EACH ROW
EXECUTE FUNCTION public.resolve_reservation_item_inventory_variant();

REVOKE EXECUTE ON FUNCTION public.resolve_reservation_item_inventory_variant()
  FROM PUBLIC, anon, authenticated;

UPDATE public.reservation_items ri
SET inventory_id = i.id
FROM public.inventory i
WHERE ri.inventory_id IS NULL
  AND i.product_doc_id = ri.product_id
  AND coalesce(i.size, '') = coalesce(ri.size, '')
  AND coalesce(i.color, '') = coalesce(ri.color, '')
  AND coalesce(i.deleted, false) = false
  AND 1 = (
    SELECT count(*)
    FROM public.inventory candidate
    WHERE candidate.product_doc_id = ri.product_id
      AND coalesce(candidate.size, '') = coalesce(ri.size, '')
      AND coalesce(candidate.color, '') = coalesce(ri.color, '')
      AND coalesce(candidate.deleted, false) = false
  );

CREATE UNIQUE INDEX IF NOT EXISTS reservation_items_one_variant_per_reservation
  ON public.reservation_items (reservation_id, inventory_id)
  WHERE inventory_id IS NOT NULL;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservation_items_inventory_required'
      AND conrelid = 'public.reservation_items'::regclass
  ) THEN
    ALTER TABLE public.reservation_items
      ADD CONSTRAINT reservation_items_inventory_required
      CHECK (inventory_id IS NOT NULL) NOT VALID;
  END IF;
END;
$block$;

-- A held line cannot be edited in place because changing its quantity or
-- variant would otherwise bypass the insert/delete inventory compensation.
CREATE OR REPLACE FUNCTION public.guard_held_reservation_item_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old_holds boolean;
  v_new_holds boolean;
BEGIN
  SELECT public.reservation_holds_stock(r.status, r.deleted)
  INTO v_old_holds
  FROM public.reservations r
  WHERE r.id = OLD.reservation_id;

  IF NEW.reservation_id = OLD.reservation_id THEN
    v_new_holds := v_old_holds;
  ELSE
    SELECT public.reservation_holds_stock(r.status, r.deleted)
    INTO v_new_holds
    FROM public.reservations r
    WHERE r.id = NEW.reservation_id;
  END IF;

  IF coalesce(v_old_holds, false) OR coalesce(v_new_holds, false) THEN
    IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
       OR NEW.inventory_id IS DISTINCT FROM OLD.inventory_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.size IS DISTINCT FROM OLD.size
       OR NEW.color IS DISTINCT FROM OLD.color
       OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      RAISE EXCEPTION 'A held reservation line cannot be changed in place.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_held_reservation_item_update ON public.reservation_items;
CREATE TRIGGER trg_guard_held_reservation_item_update
BEFORE UPDATE ON public.reservation_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_held_reservation_item_update();

REVOKE EXECUTE ON FUNCTION public.guard_held_reservation_item_update()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_deleted boolean;
  v_available integer;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
  INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = NEW.reservation_id;

  IF NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN NEW;
  END IF;

  SELECT i.available INTO v_available
  FROM public.inventory i
  WHERE i.id = NEW.inventory_id
    AND coalesce(i.deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected inventory variant is no longer active.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_available < NEW.quantity THEN
    RAISE EXCEPTION 'Only % unit(s) remain for the selected variant.', v_available
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory
  SET available = available - NEW.quantity,
      reserved = coalesce(reserved, 0) + NEW.quantity,
      updated_at = now()
  WHERE id = NEW.inventory_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_on_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_was boolean;
  v_now boolean;
  v_short record;
BEGIN
  v_was := public.reservation_holds_stock(OLD.status, OLD.deleted);
  v_now := public.reservation_holds_stock(NEW.status, NEW.deleted);

  IF lower(coalesce(OLD.status, '')) = 'completed'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A completed purchase cannot be reopened; adjust inventory through a stock command.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_was = v_now THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservation_items ri
    WHERE ri.reservation_id = NEW.id AND ri.inventory_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Reservation contains an unresolved inventory variant.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_was AND NOT v_now THEN
    WITH quantities AS (
      SELECT inventory_id, sum(quantity)::integer AS quantity
      FROM public.reservation_items
      WHERE reservation_id = NEW.id
      GROUP BY inventory_id
    )
    SELECT q.inventory_id, q.quantity, i.reserved, i.total
    INTO v_short
    FROM quantities q
    LEFT JOIN public.inventory i ON i.id = q.inventory_id
    WHERE i.id IS NULL OR i.reserved < q.quantity OR i.total < q.quantity
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Inventory hold is inconsistent for variant %.', v_short.inventory_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF lower(coalesce(NEW.status, '')) = 'completed' AND NOT coalesce(NEW.deleted, false) THEN
      WITH quantities AS (
        SELECT inventory_id, sum(quantity)::integer AS quantity
        FROM public.reservation_items
        WHERE reservation_id = NEW.id
        GROUP BY inventory_id
      )
      UPDATE public.inventory i
      SET reserved = i.reserved - q.quantity,
          total = i.total - q.quantity,
          updated_at = now()
      FROM quantities q
      WHERE i.id = q.inventory_id;
    ELSE
      WITH quantities AS (
        SELECT inventory_id, sum(quantity)::integer AS quantity
        FROM public.reservation_items
        WHERE reservation_id = NEW.id
        GROUP BY inventory_id
      )
      UPDATE public.inventory i
      SET reserved = i.reserved - q.quantity,
          available = i.available + q.quantity,
          updated_at = now()
      FROM quantities q
      WHERE i.id = q.inventory_id;
    END IF;
  ELSE
    WITH quantities AS (
      SELECT inventory_id, sum(quantity)::integer AS quantity
      FROM public.reservation_items
      WHERE reservation_id = NEW.id
      GROUP BY inventory_id
    )
    SELECT q.inventory_id, i.available, q.quantity
    INTO v_short
    FROM quantities q
    LEFT JOIN public.inventory i ON i.id = q.inventory_id AND coalesce(i.deleted, false) = false
    WHERE i.id IS NULL OR i.available < q.quantity
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Cannot activate this reservation: only % unit(s) remain for one selected variant.',
        v_short.available USING ERRCODE = 'check_violation';
    END IF;

    WITH quantities AS (
      SELECT inventory_id, sum(quantity)::integer AS quantity
      FROM public.reservation_items
      WHERE reservation_id = NEW.id
      GROUP BY inventory_id
    )
    UPDATE public.inventory i
    SET available = i.available - q.quantity,
        reserved = i.reserved + q.quantity,
        updated_at = now()
    FROM quantities q
    WHERE i.id = q.inventory_id
      AND coalesce(i.deleted, false) = false;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_deleted boolean;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
  INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = OLD.reservation_id;

  IF NOT FOUND OR NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN OLD;
  END IF;

  UPDATE public.inventory
  SET reserved = reserved - OLD.quantity,
      available = available + OLD.quantity,
      updated_at = now()
  WHERE id = OLD.inventory_id
    AND reserved >= OLD.quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory hold is missing for this reservation item.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hold_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_inventory_on_reservation_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_reservation_multi(jsonb, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_reservation_multi(jsonb, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_reservation_multi(
  _items jsonb,
  _date text,
  _appointment_time text,
  _receipt_path text DEFAULT NULL,
  _payment_option text DEFAULT 'deposit',
  _customer_id uuid DEFAULT NULL
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
     AND NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
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
  v_payment_due_at := least(now() + interval '24 hours', v_appointment - interval '1 hour');
  IF v_payment_due_at <= now() THEN
    v_payment_due_at := v_appointment;
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
    payment_status, payment_type, payment_due_at
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
    v_payment_due_at
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

REVOKE EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_multi(jsonb, text, text, text, text, uuid)
  TO authenticated;

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
  v_invalid record;
BEGIN
  IF NOT public.can_manage_inventory() THEN
    RAISE EXCEPTION 'Inventory management access required.' USING ERRCODE = '42501';
  END IF;

  SELECT ri.id, ri.reservation_id
  INTO v_invalid
  FROM public.reservation_items ri
  JOIN public.reservations r ON r.id = ri.reservation_id
  WHERE public.reservation_holds_stock(r.status, r.deleted)
    AND ri.inventory_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Cannot reconcile inventory while reservation item % has no inventory variant.', v_invalid.id;
  END IF;

  SELECT i.id, i.total, sum(ri.quantity)::integer AS expected_reserved
  INTO v_invalid
  FROM public.inventory i
  JOIN public.reservation_items ri ON ri.inventory_id = i.id
  JOIN public.reservations r ON r.id = ri.reservation_id
  WHERE public.reservation_holds_stock(r.status, r.deleted)
  GROUP BY i.id, i.total
  HAVING sum(ri.quantity) > i.total
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Inventory variant % has % units but reservations require %.',
      v_invalid.id, v_invalid.total, v_invalid.expected_reserved;
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Administrator')
  INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_actor;

  WITH calculated AS (
    SELECT i.id,
      coalesce(sum(ri.quantity) FILTER (
        WHERE public.reservation_holds_stock(r.status, r.deleted)
      ), 0)::integer AS reserved
    FROM public.inventory i
    LEFT JOIN public.reservation_items ri ON ri.inventory_id = i.id
    LEFT JOIN public.reservations r ON r.id = ri.reservation_id
    WHERE coalesce(i.deleted, false) = false
    GROUP BY i.id
  ), updated AS (
    UPDATE public.inventory i
    SET reserved = c.reserved,
        available = i.total - c.reserved,
        updated_at = v_now
    FROM calculated c
    WHERE i.id = c.id
      AND (i.reserved IS DISTINCT FROM c.reserved OR i.available IS DISTINCT FROM i.total - c.reserved)
    RETURNING i.id
  )
  SELECT count(*) INTO v_inventory_count FROM updated;

  WITH totals AS (
    SELECT i.product_doc_id,
      coalesce(sum(i.available), 0)::integer AS available,
      coalesce(sum(i.reserved), 0)::integer AS reserved
    FROM public.inventory i
    WHERE coalesce(i.deleted, false) = false
      AND i.product_doc_id IS NOT NULL
    GROUP BY i.product_doc_id
  ), updated AS (
    UPDATE public.products p
    SET stock = t.available,
        status = CASE
          WHEN t.available <= 0 THEN CASE WHEN t.reserved > 0 THEN 'Reserved' ELSE 'Out of Stock' END
          ELSE 'In Boutique'
        END,
        updated_at = v_now
    FROM totals t
    WHERE p.id = t.product_doc_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_product_count FROM updated;

  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details, timestamp)
  VALUES (
    v_actor,
    coalesce(v_actor_name, 'Administrator'),
    'Recalculated Inventory Stock',
    'system',
    'inventory',
    jsonb_build_object('inventoryUpdated', v_inventory_count, 'productsUpdated', v_product_count),
    v_now
  );

  RETURN jsonb_build_object('inventory_rows', v_inventory_count, 'products', v_product_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recalculate_inventory_stock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_stock() TO authenticated;
