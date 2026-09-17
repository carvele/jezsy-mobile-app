-- Migration: 20260917150000_reconcile_product_variants_rpc.sql
-- Description: Transactional Catalog ↔ Inventory variant lifecycle reconciliation.
-- Archives deselected variants without losing stock/history, restores matching archived rows
-- to avoid duplicates, generates canonical SKUs, enforces atomic reservation guards,
-- and cleans up unreferenced 0-stock archived phantom duplicate rows.

-- 1. Idempotent cleanup of existing unreferenced 0-stock archived duplicates
DELETE FROM public.inventory i
WHERE i.deleted = true
  AND i.total = 0
  AND i.reserved = 0
  AND i.available = 0
  AND NOT EXISTS (SELECT 1 FROM public.reservation_items ri WHERE ri.inventory_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.inventory_id = i.id)
  AND EXISTS (
    SELECT 1 FROM public.inventory a
    WHERE a.product_doc_id = i.product_doc_id
      AND TRIM(UPPER(COALESCE(a.size, ''))) = TRIM(UPPER(COALESCE(i.size, '')))
      AND TRIM(LOWER(COALESCE(a.color, ''))) = TRIM(LOWER(COALESCE(i.color, '')))
      AND a.deleted = false
      AND a.id <> i.id
  );

-- 2. Create or replace reconcile_product_variants RPC
CREATE OR REPLACE FUNCTION public.reconcile_product_variants(
    p_product_id uuid,
    p_desired_variants jsonb,
    p_product_name text DEFAULT NULL,
    p_category text DEFAULT NULL,
    p_style_code text DEFAULT NULL,
    p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid := COALESCE(p_actor_id, auth.uid());
  v_actor_name   text;
  v_prod         public.products%ROWTYPE;
  v_name         text;
  v_category     text;
  v_style_code   text;
  v_now          timestamptz := now();
  
  -- Counters
  v_archived_count  integer := 0;
  v_restored_count  integer := 0;
  v_created_count   integer := 0;
  v_unchanged_count integer := 0;
  
  -- Record vars
  v_inv             public.inventory%ROWTYPE;
  v_orig_size       text;
  v_orig_color      text;
  v_norm_size       text;
  v_norm_color      text;
  v_variant_sku     text;
  v_clean_code      text;
  v_clean_color     text;
  v_clean_sz        text;
  v_colors          text[];
  v_color_str       text := '';
  v_base_color      text := NULL;
  
  -- Conflict detection
  v_reserved_conflict text;
BEGIN
  -- 1. Authorization check (staff with inventory access, or service_role/postgres)
  IF (COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role')
     AND (current_user NOT IN ('postgres', 'service_role'))
     AND (NOT public.can_manage_inventory())
  THEN
    RAISE EXCEPTION 'Inventory management access required.' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product ID is required.';
  END IF;

  SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email, 'Administrator')
  INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  -- 2. Lock and fetch parent product
  SELECT * INTO v_prod
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found.', p_product_id;
  END IF;

  v_name := COALESCE(NULLIF(TRIM(p_product_name), ''), v_prod.name);
  v_category := COALESCE(NULLIF(TRIM(p_category), ''), v_prod.category);
  v_style_code := COALESCE(NULLIF(TRIM(p_style_code), ''), v_prod.style_code);

  -- 3. Lock all inventory rows for this product
  PERFORM 1
  FROM public.inventory
  WHERE product_doc_id = p_product_id
  FOR UPDATE;

  -- 4. Atomic Reservation Guard
  -- Check if any active variant about to be archived has reserved stock > 0
  SELECT string_agg(
    format('%s / %s (%s unit(s) reserved)', COALESCE(NULLIF(color, ''), 'Standard'), size, reserved),
    ', '
  )
  INTO v_reserved_conflict
  FROM public.inventory i
  WHERE i.product_doc_id = p_product_id
    AND i.deleted = false
    AND COALESCE(i.reserved, 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_desired_variants, '[]'::jsonb)) AS elem
      WHERE UPPER(TRIM(COALESCE(elem->>'size', ''))) = UPPER(TRIM(COALESCE(i.size, '')))
        AND LOWER(TRIM(COALESCE(elem->>'color', ''))) = LOWER(TRIM(COALESCE(i.color, '')))
    );

  IF v_reserved_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot remove variant(s) with active customer reservations: %', v_reserved_conflict
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Archive unselected active variants
  FOR v_inv IN
    SELECT *
    FROM public.inventory i
    WHERE i.product_doc_id = p_product_id
      AND i.deleted = false
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_desired_variants, '[]'::jsonb)) AS elem
        WHERE UPPER(TRIM(COALESCE(elem->>'size', ''))) = UPPER(TRIM(COALESCE(i.size, '')))
          AND LOWER(TRIM(COALESCE(elem->>'color', ''))) = LOWER(TRIM(COALESCE(i.color, '')))
      )
  LOOP
    UPDATE public.inventory
    SET deleted = true,
        deleted_at = v_now,
        updated_at = v_now
    WHERE id = v_inv.id;

    v_archived_count := v_archived_count + 1;

    INSERT INTO public.logs (
      user_id, user_name, action, target_type, target_id, details, timestamp
    ) VALUES (
      v_actor, COALESCE(v_actor_name, 'Administrator'), 'Archived inventory item',
      'product', p_product_id::text,
      jsonb_build_object(
        'inventoryId', v_inv.id,
        'itemName', v_inv.item,
        'size', v_inv.size,
        'color', COALESCE(v_inv.color, ''),
        'total', v_inv.total,
        'reserved', v_inv.reserved,
        'available', v_inv.available,
        'reason', 'Variant removed from product catalog'
      ),
      v_now
    );
  END LOOP;

  -- 6. Restore or Create desired variants
  FOR v_orig_size, v_orig_color, v_norm_size, v_norm_color IN
    SELECT DISTINCT ON (UPPER(TRIM(COALESCE(elem->>'size', ''))), LOWER(TRIM(COALESCE(elem->>'color', ''))))
      COALESCE(TRIM(elem->>'size'), '') AS orig_size,
      COALESCE(TRIM(elem->>'color'), '') AS orig_color,
      UPPER(TRIM(COALESCE(elem->>'size', ''))) AS norm_size,
      LOWER(TRIM(COALESCE(elem->>'color', ''))) AS norm_color
    FROM jsonb_array_elements(COALESCE(p_desired_variants, '[]'::jsonb)) AS elem
    WHERE UPPER(TRIM(COALESCE(elem->>'size', ''))) <> '' OR LOWER(TRIM(COALESCE(elem->>'color', ''))) <> ''
  LOOP
    -- Check if an active row already exists
    SELECT * INTO v_inv
    FROM public.inventory
    WHERE product_doc_id = p_product_id
      AND deleted = false
      AND UPPER(TRIM(COALESCE(size, ''))) = v_norm_size
      AND LOWER(TRIM(COALESCE(color, ''))) = v_norm_color
    LIMIT 1;

    IF FOUND THEN
      -- Already active, update metadata if needed
      UPDATE public.inventory
      SET item = v_name,
          category = v_category,
          sku = COALESCE(sku, v_style_code),
          updated_at = v_now
      WHERE id = v_inv.id
        AND (item IS DISTINCT FROM v_name OR category IS DISTINCT FROM v_category);
      v_unchanged_count := v_unchanged_count + 1;
    ELSE
      -- Check if an archived row exists to restore (prefer row with total > 0, then latest updated)
      SELECT * INTO v_inv
      FROM public.inventory
      WHERE product_doc_id = p_product_id
        AND deleted = true
        AND UPPER(TRIM(COALESCE(size, ''))) = v_norm_size
        AND LOWER(TRIM(COALESCE(color, ''))) = v_norm_color
      ORDER BY (total > 0) DESC, updated_at DESC
      LIMIT 1;

      IF FOUND THEN
        -- Restore existing row
        UPDATE public.inventory
        SET deleted = false,
            deleted_at = NULL,
            item = v_name,
            category = v_category,
            sku = COALESCE(sku, v_style_code),
            updated_at = v_now
        WHERE id = v_inv.id;

        v_restored_count := v_restored_count + 1;

        INSERT INTO public.logs (
          user_id, user_name, action, target_type, target_id, details, timestamp
        ) VALUES (
          v_actor, COALESCE(v_actor_name, 'Administrator'), 'Restored inventory item',
          'product', p_product_id::text,
          jsonb_build_object(
            'inventoryId', v_inv.id,
            'itemName', v_name,
            'size', v_inv.size,
            'color', COALESCE(v_inv.color, ''),
            'total', v_inv.total,
            'reserved', v_inv.reserved,
            'available', v_inv.available,
            'reason', 'Variant restored from product catalog'
          ),
          v_now
        );
      ELSE
        -- Generate variant SKU
        v_clean_code := UPPER(TRIM(COALESCE(v_style_code, '')));
        v_clean_color := UPPER(REGEXP_REPLACE(COALESCE(v_orig_color, ''), '[^A-Za-z0-9]+', '', 'g'));
        v_clean_sz := UPPER(REGEXP_REPLACE(COALESCE(v_orig_size, ''), '[^A-Za-z0-9]+', '', 'g'));

        IF v_clean_code <> '' THEN
          IF v_clean_color <> '' THEN
            v_variant_sku := v_clean_code || '-' || v_clean_color || '-' || v_clean_sz;
          ELSE
            v_variant_sku := v_clean_code || '-' || v_clean_sz;
          END IF;
        ELSE
          v_variant_sku := NULL;
        END IF;

        INSERT INTO public.inventory (
          product_doc_id, item, category, size, color, pattern,
          sku, variant_sku, total, reserved, available, deleted,
          created_at, updated_at
        ) VALUES (
          p_product_id, v_name, v_category, v_orig_size, v_orig_color, '',
          v_style_code, v_variant_sku, 0, 0, 0, false,
          v_now, v_now
        )
        RETURNING * INTO v_inv;

        v_created_count := v_created_count + 1;

        INSERT INTO public.logs (
          user_id, user_name, action, target_type, target_id, details, timestamp
        ) VALUES (
          v_actor, COALESCE(v_actor_name, 'Administrator'), 'Created inventory variant',
          'product', p_product_id::text,
          jsonb_build_object(
            'inventoryId', v_inv.id,
            'itemName', v_name,
            'size', v_orig_size,
            'color', v_orig_color,
            'sku', v_variant_sku
          ),
          v_now
        );
      END IF;
    END IF;
  END LOOP;

  -- 7. Synchronize products.color and base_color from all active variants
  SELECT array_agg(DISTINCT color ORDER BY color)
  INTO v_colors
  FROM public.inventory
  WHERE product_doc_id = p_product_id
    AND deleted = false
    AND NULLIF(TRIM(color), '') IS NOT NULL;

  IF v_colors IS NOT NULL AND array_length(v_colors, 1) > 0 THEN
    v_color_str := array_to_string(v_colors, ', ');
    v_base_color := v_colors[1];
  ELSE
    v_color_str := '';
    v_base_color := NULL;
  END IF;

  UPDATE public.products
  SET color = v_color_str,
      base_color = v_base_color,
      updated_at = v_now
  WHERE id = p_product_id;

  -- 8. Trigger stock recalculation on product
  PERFORM public.sync_product_stock(p_product_id);

  RETURN jsonb_build_object(
    'success', true,
    'productId', p_product_id,
    'archivedCount', v_archived_count,
    'restoredCount', v_restored_count,
    'createdCount', v_created_count,
    'unchangedCount', v_unchanged_count,
    'activeColors', v_color_str
  );
END;
$$;

-- 3. Grants and security
GRANT EXECUTE ON FUNCTION public.reconcile_product_variants(uuid, jsonb, text, text, text, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reconcile_product_variants(uuid, jsonb, text, text, text, uuid) FROM anon, PUBLIC;
