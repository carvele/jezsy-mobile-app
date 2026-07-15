-- Resume audit hardening after partial/manual SQL runs.
-- This file is intentionally defensive: it only applies each change when the
-- target table/column exists and the change has not already been applied.

-- Keep payment receipts private and owner-scoped.
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment_receipts', 'payment_receipts', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

DROP POLICY IF EXISTS "Public can view payment receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own payment receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own payment receipts" ON storage.objects;

CREATE POLICY "Users can upload their own payment receipts"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment_receipts'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

CREATE POLICY "Users can read their own payment receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment_receipts'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

ALTER TABLE IF EXISTS public.reservations
ADD COLUMN IF NOT EXISTS receipt_url text;

-- Reservation validation and capacity enforcement.
DO $$
BEGIN
  IF to_regclass('public.reservations') IS NOT NULL
     AND to_regclass('public.store_hours') IS NOT NULL
     AND to_regclass('public.store_closures') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.validate_reservation_time()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $fn$
      DECLARE
        day_idx integer;
        standard_hours record;
        closure_record record;
        store_open time;
        store_close time;
        appt_time time;
        existing_count integer;
      BEGIN
        IF NEW.date IS NULL OR NEW.appointment_time IS NULL THEN
          RETURN NEW;
        END IF;

        appt_time := NEW.appointment_time::time;

        IF (EXTRACT(minute FROM appt_time)::integer % 30) <> 0
           OR EXTRACT(second FROM appt_time)::integer <> 0 THEN
          RAISE EXCEPTION 'Appointment time must be on a 30-minute boundary.';
        END IF;

        day_idx := EXTRACT(dow FROM NEW.date::date);

        SELECT *
        INTO standard_hours
        FROM public.store_hours
        WHERE day_of_week = day_idx;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Store hours are not configured for this day.';
        END IF;

        SELECT *
        INTO closure_record
        FROM public.store_closures
        WHERE closure_date = NEW.date::date;

        IF FOUND THEN
          IF COALESCE(closure_record.is_fully_closed, true) THEN
            RAISE EXCEPTION 'Boutique is closed on this date: %', COALESCE(closure_record.reason, 'Closed');
          END IF;

          store_open := COALESCE(closure_record.custom_open_time, standard_hours.open_time);
          store_close := COALESCE(closure_record.custom_close_time, standard_hours.close_time);
        ELSE
          IF COALESCE(standard_hours.is_closed, false) THEN
            RAISE EXCEPTION 'Boutique is normally closed on this day of the week.';
          END IF;

          store_open := standard_hours.open_time;
          store_close := standard_hours.close_time;
        END IF;

        IF store_open IS NULL OR store_close IS NULL OR store_open >= store_close THEN
          RAISE EXCEPTION 'Store hours are invalid for this date.';
        END IF;

        IF appt_time < store_open OR appt_time >= store_close THEN
          RAISE EXCEPTION 'Appointment time is outside of operating hours (% - %).', store_open, store_close;
        END IF;

        IF COALESCE(NEW.deleted, false) = false
           AND lower(COALESCE(NEW.status, 'pending')) NOT IN ('cancelled', 'completed') THEN
          SELECT count(*)
          INTO existing_count
          FROM public.reservations r
          WHERE r.date::date = NEW.date::date
            AND r.appointment_time::time = appt_time
            AND COALESCE(r.deleted, false) = false
            AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
            AND (TG_OP = 'INSERT' OR r.id <> NEW.id);

          IF existing_count >= 3 THEN
            RAISE EXCEPTION 'This time slot is fully booked. Please select another time.';
          END IF;
        END IF;

        RETURN NEW;
      END;
      $fn$;
    $ddl$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_validate_reservation_time ON public.reservations';
    EXECUTE $ddl$
      CREATE TRIGGER trg_validate_reservation_time
      BEFORE INSERT OR UPDATE OF date, appointment_time, status, deleted ON public.reservations
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_reservation_time()
    $ddl$;
  END IF;
END $$;

-- Atomic checkout RPC.
DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL
     AND to_regclass('public.order_items') IS NOT NULL
     AND to_regclass('public.products') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.create_order(_shipping_address jsonb, _items jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public, pg_temp
      AS $fn$
      DECLARE
        v_user_id uuid := auth.uid();
        v_order public.orders%rowtype;
        v_item jsonb;
        v_product record;
        v_quantity integer;
        v_total numeric := 0;
        v_display_id text;
        v_attempt integer := 0;
      BEGIN
        IF v_user_id IS NULL THEN
          RAISE EXCEPTION 'Authentication required.';
        END IF;

        IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
          RAISE EXCEPTION 'Order must contain at least one item.';
        END IF;

        LOOP
          v_attempt := v_attempt + 1;
          v_display_id := 'ORD-' || floor(100000 + random() * 900000)::text;
          EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.orders WHERE display_id = v_display_id
          );

          IF v_attempt > 10 THEN
            RAISE EXCEPTION 'Could not allocate order number.';
          END IF;
        END LOOP;

        INSERT INTO public.orders (
          customer_id,
          display_id,
          total_amount,
          shipping_address,
          status
        )
        VALUES (
          v_user_id,
          v_display_id,
          0,
          _shipping_address,
          'paid'
        )
        RETURNING * INTO v_order;

        FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
        LOOP
          v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

          IF v_quantity < 1 THEN
            RAISE EXCEPTION 'Item quantity must be positive.';
          END IF;

          SELECT
            id,
            COALESCE(sale_price, price, 0)::numeric AS unit_price
          INTO v_product
          FROM public.products
          WHERE id = (v_item->>'product_id')::uuid
            AND visibility = 'public'
            AND COALESCE(deleted, false) = false
          FOR SHARE;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'Product is unavailable.';
          END IF;

          IF v_product.unit_price < 0 THEN
            RAISE EXCEPTION 'Product price is invalid.';
          END IF;

          INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            selected_size,
            selected_color
          )
          VALUES (
            v_order.id,
            v_product.id,
            v_quantity,
            v_product.unit_price,
            NULLIF(v_item->>'selected_size', ''),
            NULLIF(v_item->>'selected_color', '')
          );

          v_total := v_total + (v_product.unit_price * v_quantity);
        END LOOP;

        UPDATE public.orders
        SET total_amount = v_total
        WHERE id = v_order.id
        RETURNING * INTO v_order;

        RETURN to_jsonb(v_order);
      END;
      $fn$;
    $ddl$;

    REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) FROM anon;
    GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) TO authenticated;
  END IF;
END $$;

-- Streak helper only applies when the optional table exists.
DO $$
BEGIN
  IF to_regclass('public.user_streaks') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.update_user_streak(p_user_id uuid)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public, pg_temp
      AS $fn$
      DECLARE
        v_streak public.user_streaks%rowtype;
        v_today date := CURRENT_DATE;
      BEGIN
        IF p_user_id IS DISTINCT FROM auth.uid() THEN
          RAISE EXCEPTION 'Cannot update another user streak.';
        END IF;

        SELECT *
        INTO v_streak
        FROM public.user_streaks
        WHERE user_id = p_user_id;

        IF NOT FOUND THEN
          INSERT INTO public.user_streaks (
            user_id,
            current_streak,
            longest_streak,
            last_action_date
          )
          VALUES (p_user_id, 1, 1, v_today);
        ELSIF v_streak.last_action_date = v_today THEN
          RETURN;
        ELSIF v_streak.last_action_date = v_today - INTERVAL '1 day' THEN
          UPDATE public.user_streaks
          SET
            current_streak = COALESCE(current_streak, 0) + 1,
            longest_streak = GREATEST(COALESCE(longest_streak, 0), COALESCE(current_streak, 0) + 1),
            last_action_date = v_today,
            updated_at = NOW()
          WHERE user_id = p_user_id;
        ELSE
          UPDATE public.user_streaks
          SET
            current_streak = 1,
            last_action_date = v_today,
            updated_at = NOW()
          WHERE user_id = p_user_id;
        END IF;
      END;
      $fn$;
    $ddl$;

    REVOKE EXECUTE ON FUNCTION public.update_user_streak(uuid) FROM anon;
    GRANT EXECUTE ON FUNCTION public.update_user_streak(uuid) TO authenticated;
  END IF;
END $$;

-- RLS policies needed by checkout and order history.
DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users can view own orders" ON public.orders';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders';

    EXECUTE $ddl$
      CREATE POLICY "Users can view own orders"
      ON public.orders
      FOR SELECT
      TO authenticated
      USING (customer_id = (SELECT auth.uid()))
    $ddl$;

    EXECUTE $ddl$
      CREATE POLICY "Users can insert own orders"
      ON public.orders
      FOR INSERT
      TO authenticated
      WITH CHECK (customer_id = (SELECT auth.uid()))
    $ddl$;
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL
     AND to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert own order items" ON public.order_items';

    EXECUTE $ddl$
      CREATE POLICY "Users can view own order items"
      ON public.order_items
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = order_items.order_id
            AND o.customer_id = (SELECT auth.uid())
        )
      )
    $ddl$;

    EXECUTE $ddl$
      CREATE POLICY "Users can insert own order items"
      ON public.order_items
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id = order_items.order_id
            AND o.customer_id = (SELECT auth.uid())
        )
      )
    $ddl$;
  END IF;
END $$;

-- Indexes and de-duplication.
DO $$
DECLARE
  has_duplicate_order_ids boolean := false;
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1
        FROM public.orders
        WHERE display_id IS NOT NULL
        GROUP BY display_id
        HAVING count(*) > 1
      )
    $sql$
    INTO has_duplicate_order_ids;

    IF NOT has_duplicate_order_ids THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS orders_display_id_uidx ON public.orders (display_id)';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON public.orders (customer_id, created_at DESC)';
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items (order_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON public.order_items (product_id)';
  END IF;

  IF to_regclass('public.reservations') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS reservations_customer_deleted_created_idx ON public.reservations (customer_id, deleted, created_at DESC)';
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS reservations_slot_active_idx
      ON public.reservations (date, appointment_time)
      WHERE COALESCE(deleted, false) = false
        AND lower(COALESCE(status, 'pending')) NOT IN ('cancelled', 'completed')
    $sql$;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC)';
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS reviews_product_created_idx ON public.reviews (product_id, created_at DESC)';
  END IF;

  IF to_regclass('public.wardrobe_items') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS wardrobe_items_user_created_idx
      ON public.wardrobe_items (user_id, created_at DESC)
      WHERE COALESCE(deleted, false) = false
    $sql$;
  END IF;

  IF to_regclass('public.saved_outfits') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS saved_outfits_user_created_idx
      ON public.saved_outfits (user_id, created_at DESC)
      WHERE COALESCE(deleted, false) = false
    $sql$;
  END IF;

  IF to_regclass('public.capsules') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS capsules_user_created_idx ON public.capsules (user_id, created_at DESC)';
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS products_public_catalog_idx ON public.products (visibility, deleted, category, sub_category, created_at DESC)';
  END IF;

  IF to_regclass('public.wishlists') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS wishlists_user_id_idx ON public.wishlists (user_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS wishlists_product_id_idx ON public.wishlists (product_id)';

    EXECUTE $sql$
      WITH ranked_wishlists AS (
        SELECT
          ctid,
          row_number() OVER (
            PARTITION BY user_id, product_id
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM public.wishlists
      )
      DELETE FROM public.wishlists w
      USING ranked_wishlists r
      WHERE w.ctid = r.ctid
        AND r.rn > 1
    $sql$;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS wishlists_user_product_uidx ON public.wishlists (user_id, product_id)';
  END IF;

  IF to_regclass('public.user_measurements') IS NOT NULL THEN
    EXECUTE $sql$
      WITH ranked_measurements AS (
        SELECT
          ctid,
          row_number() OVER (
            PARTITION BY user_id
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM public.user_measurements
      )
      DELETE FROM public.user_measurements m
      USING ranked_measurements r
      WHERE m.ctid = r.ctid
        AND r.rn > 1
    $sql$;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS user_measurements_user_id_uidx ON public.user_measurements (user_id)';
  END IF;
END $$;

-- New-row validation constraints.
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'reviews_rating_range'
         AND conrelid = to_regclass('public.reviews')
     ) THEN
    EXECUTE 'ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5) NOT VALID';
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'order_items_quantity_positive'
         AND conrelid = to_regclass('public.order_items')
     ) THEN
    EXECUTE 'ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0) NOT VALID';
  END IF;

  IF to_regclass('public.orders') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'orders_total_amount_nonnegative'
         AND conrelid = to_regclass('public.orders')
     ) THEN
    EXECUTE 'ALTER TABLE public.orders ADD CONSTRAINT orders_total_amount_nonnegative CHECK (total_amount >= 0) NOT VALID';
  END IF;

  IF to_regclass('public.products') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'price'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'sale_price'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'stock'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'products_price_nonnegative'
         AND conrelid = to_regclass('public.products')
     ) THEN
    EXECUTE $sql$
      ALTER TABLE public.products
      ADD CONSTRAINT products_price_nonnegative
      CHECK (
        (price IS NULL OR price >= 0)
        AND (sale_price IS NULL OR sale_price >= 0)
        AND (stock IS NULL OR stock >= 0)
      ) NOT VALID
    $sql$;
  END IF;

  IF to_regclass('public.user_measurements') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_measurements'
         AND column_name = 'scan_confidence'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'user_measurements_confidence_range'
         AND conrelid = to_regclass('public.user_measurements')
     ) THEN
    EXECUTE $sql$
      ALTER TABLE public.user_measurements
      ADD CONSTRAINT user_measurements_confidence_range
      CHECK (scan_confidence IS NULL OR (scan_confidence >= 0 AND scan_confidence <= 1)) NOT VALID
    $sql$;
  END IF;

  IF to_regclass('public.store_hours') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'store_hours_valid_times'
         AND conrelid = to_regclass('public.store_hours')
     ) THEN
    EXECUTE 'ALTER TABLE public.store_hours ADD CONSTRAINT store_hours_valid_times CHECK (is_closed OR open_time < close_time) NOT VALID';
  END IF;

  IF to_regclass('public.store_closures') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'store_closures_valid_custom_hours'
         AND conrelid = to_regclass('public.store_closures')
     ) THEN
    EXECUTE $sql$
      ALTER TABLE public.store_closures
      ADD CONSTRAINT store_closures_valid_custom_hours
      CHECK (
        is_fully_closed
        OR custom_open_time IS NULL
        OR custom_close_time IS NULL
        OR custom_open_time < custom_close_time
      ) NOT VALID
    $sql$;
  END IF;
END $$;
