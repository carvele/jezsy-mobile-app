-- 20260917224500_atomic_product_variants_and_pagination.sql
-- Implements Stage 2 Operating Contract for Inventory: Atomic Variants and Bounded Retrieval

CREATE OR REPLACE FUNCTION public.upsert_product_with_colorways(_product_payload jsonb, _colorways_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_product_id UUID;
  v_default_colorway_id UUID;
  v_colorway_elem JSONB;
  v_default_colorway JSONB;
  v_new_colorway_id UUID;
  v_image_elem JSONB;
  v_image_url TEXT;
  v_images_array TEXT[] := ARRAY[]::TEXT[];
  v_default_images_array TEXT[] := ARRAY[]::TEXT[];
  v_color_names TEXT[] := ARRAY[]::TEXT[];
  v_default_color_name TEXT := NULL;
  v_default_count INTEGER := 0;
  v_sort_order INTEGER;
  
  v_size_elem TEXT;
  v_color_elem TEXT;
  v_style_code TEXT;
  v_variants_created INTEGER := 0;
  v_sizes TEXT[];
  v_sku_str TEXT;
  v_existing_inv_id UUID;
  v_reserved_conflict TEXT;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. Authorization boundary
  IF auth.role() <> 'service_role' AND NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Access denied: staff or admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF _product_payload IS NULL THEN
    RAISE EXCEPTION 'Product payload cannot be null';
  END IF;

  -- 2. Extract Colorways / Colors
  IF _colorways_payload IS NOT NULL AND jsonb_array_length(_colorways_payload) > 0 THEN
    FOR v_colorway_elem IN SELECT * FROM jsonb_array_elements(_colorways_payload) LOOP
      IF (v_colorway_elem->>'is_default')::boolean IS TRUE THEN
        v_default_count := v_default_count + 1;
        v_default_colorway := v_colorway_elem;
      END IF;
    END LOOP;

    IF v_default_count > 1 THEN
      RAISE EXCEPTION 'Only one default colorway can be designated';
    ELSIF v_default_count = 0 THEN
      v_default_colorway := _colorways_payload->0;
    END IF;

    v_default_color_name := v_default_colorway->>'color_name';

    IF v_default_colorway->'images' IS NOT NULL THEN
      FOR v_image_elem IN SELECT * FROM jsonb_array_elements(v_default_colorway->'images') LOOP
        IF jsonb_typeof(v_image_elem) = 'object' THEN
          v_image_url := v_image_elem->>'image_url';
        ELSE
          v_image_url := v_image_elem#>>'{}';
        END IF;
        IF v_image_url IS NOT NULL AND v_image_url <> '' THEN
          v_default_images_array := array_append(v_default_images_array, v_image_url);
        END IF;
      END LOOP;
    END IF;

    FOR v_colorway_elem IN SELECT * FROM jsonb_array_elements(_colorways_payload) LOOP
      v_color_names := array_append(v_color_names, v_colorway_elem->>'color_name');
    END LOOP;
  ELSIF _product_payload->'colors' IS NOT NULL 
    AND jsonb_typeof(_product_payload->'colors') = 'array' 
    AND jsonb_array_length(_product_payload->'colors') > 0 THEN
    v_color_names := ARRAY(SELECT jsonb_array_elements_text(_product_payload->'colors'));
    v_default_color_name := v_color_names[1];
  ELSIF _product_payload->>'color' IS NOT NULL AND trim(_product_payload->>'color') <> '' THEN
    v_color_names := ARRAY(
      SELECT trim(elem) 
      FROM unnest(string_to_array(_product_payload->>'color', ',')) AS elem 
      WHERE trim(elem) <> ''
    );
    IF array_length(v_color_names, 1) > 0 THEN
      v_default_color_name := v_color_names[1];
    END IF;
  ELSE
    v_color_names := ARRAY[''];
    v_default_color_name := NULL;
  END IF;

  v_sizes := ARRAY(SELECT jsonb_array_elements_text(_product_payload->'sizes'));
  v_style_code := COALESCE(_product_payload->>'style_code', '');

  -- 3. Upsert Product
  IF _product_payload->>'id' IS NOT NULL AND (_product_payload->>'id')::text <> '' THEN
    v_product_id := (_product_payload->>'id')::uuid;
    IF v_style_code = '' THEN
      SELECT style_code INTO v_style_code FROM public.products WHERE id = v_product_id;
    END IF;
    
    UPDATE public.products
    SET
      name = COALESCE(_product_payload->>'name', name),
      category = COALESCE(_product_payload->>'category', category),
      sub_category = COALESCE(_product_payload->>'sub_category', sub_category),
      category_id = COALESCE((_product_payload->>'category_id')::uuid, category_id),
      price = COALESCE((_product_payload->>'price')::numeric, price),
      description = COALESCE(_product_payload->>'description', description),
      material = COALESCE(_product_payload->>'material', material),
      garment_metadata = COALESCE((_product_payload->'garment_metadata')::jsonb, garment_metadata),
      care_instructions = COALESCE(_product_payload->>'care_instructions', care_instructions),
      fit_and_sizing = COALESCE(_product_payload->>'fit_and_sizing', fit_and_sizing),
      style_code = COALESCE(_product_payload->>'style_code', style_code),
      season = COALESCE(_product_payload->>'season', season),
      occasion = COALESCE(_product_payload->>'occasion', occasion),
      visibility = COALESCE(_product_payload->>'visibility', visibility),
      is_featured = COALESCE((_product_payload->>'is_featured')::boolean, is_featured),
      is_new_arrival = COALESCE((_product_payload->>'is_new_arrival')::boolean, is_new_arrival),
      is_alterable = COALESCE((_product_payload->>'is_alterable')::boolean, is_alterable),
      on_sale = COALESCE((_product_payload->>'on_sale')::boolean, on_sale),
      sale_price = (_product_payload->>'sale_price')::numeric,
      discount_percentage = COALESCE((_product_payload->>'discount_percentage')::numeric, discount_percentage),
      sizes = COALESCE(v_sizes, sizes),
      stock = COALESCE((_product_payload->>'stock')::integer, stock),
      tags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(_product_payload->'tags')), tags),
      pattern = COALESCE(_product_payload->>'pattern', pattern),
      base_color = COALESCE(v_default_color_name, _product_payload->>'base_color', base_color),
      color = CASE WHEN array_length(v_color_names, 1) > 0 AND v_color_names[1] <> '' THEN array_to_string(v_color_names, ', ') ELSE color END,
      image_url = COALESCE(v_default_colorway->>'primary_image_url', (v_default_images_array)[1], _product_payload->>'imageUrl', image_url),
      images = CASE WHEN _product_payload->'images' IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(_product_payload->'images')) ELSE (CASE WHEN array_length(v_default_images_array, 1) > 0 THEN v_default_images_array ELSE images END) END,
      updated_at = v_now
    WHERE id = v_product_id;
  ELSE
    INSERT INTO public.products (
      name, category, sub_category, category_id, price, description, material,
      garment_metadata, care_instructions, fit_and_sizing, style_code, season, occasion,
      visibility, is_featured, is_new_arrival, is_alterable, on_sale,
      sale_price, discount_percentage, sizes, stock, tags, pattern,
      base_color, color, image_url, images, created_by
    ) VALUES (
      _product_payload->>'name',
      _product_payload->>'category',
      _product_payload->>'sub_category',
      (_product_payload->>'category_id')::uuid,
      (_product_payload->>'price')::numeric,
      _product_payload->>'description',
      _product_payload->>'material',
      (_product_payload->'garment_metadata')::jsonb,
      _product_payload->>'care_instructions',
      _product_payload->>'fit_and_sizing',
      _product_payload->>'style_code',
      _product_payload->>'season',
      _product_payload->>'occasion',
      COALESCE(_product_payload->>'visibility', 'public'),
      COALESCE((_product_payload->>'is_featured')::boolean, false),
      COALESCE((_product_payload->>'is_new_arrival')::boolean, false),
      COALESCE((_product_payload->>'is_alterable')::boolean, false),
      COALESCE((_product_payload->>'on_sale')::boolean, false),
      (_product_payload->>'sale_price')::numeric,
      COALESCE((_product_payload->>'discount_percentage')::numeric, 0),
      v_sizes,
      COALESCE((_product_payload->>'stock')::integer, 0),
      ARRAY(SELECT jsonb_array_elements_text(_product_payload->'tags')),
      COALESCE(_product_payload->>'pattern', 'Solid'),
      COALESCE(v_default_color_name, _product_payload->>'base_color'),
      CASE WHEN array_length(v_color_names, 1) > 0 AND v_color_names[1] <> '' THEN array_to_string(v_color_names, ', ') ELSE '' END,
      COALESCE(v_default_colorway->>'primary_image_url', (v_default_images_array)[1], _product_payload->>'imageUrl'),
      CASE WHEN _product_payload->'images' IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(_product_payload->'images')) ELSE v_default_images_array END,
      (_product_payload->>'created_by')::uuid
    )
    RETURNING id INTO v_product_id;
    
    IF v_style_code = '' THEN
      v_style_code := v_product_id::text;
    END IF;
  END IF;

  -- 4. Colorways Upsert (if colorways payload provided)
  IF _colorways_payload IS NOT NULL AND jsonb_array_length(_colorways_payload) > 0 THEN
    UPDATE public.product_colorways
    SET is_default = false
    WHERE product_id = v_product_id AND is_default = true;

    FOR v_colorway_elem IN SELECT * FROM jsonb_array_elements(_colorways_payload) LOOP
      IF v_colorway_elem->>'id' IS NOT NULL AND (v_colorway_elem->>'id')::text <> '' THEN
        v_new_colorway_id := (v_colorway_elem->>'id')::uuid;
        UPDATE public.product_colorways
        SET
          color_name = v_colorway_elem->>'color_name',
          display_name = v_colorway_elem->>'display_name',
          hex_color = v_colorway_elem->>'hex_color',
          primary_image_url = v_colorway_elem->>'primary_image_url',
          sort_order = COALESCE((v_colorway_elem->>'sort_order')::integer, 0),
          is_default = (v_colorway_elem->>'color_name' = v_default_color_name),
          is_active = COALESCE((v_colorway_elem->>'is_active')::boolean, true),
          updated_at = v_now
        WHERE id = v_new_colorway_id AND product_id = v_product_id;
      ELSE
        INSERT INTO public.product_colorways (
          product_id, color_name, display_name, hex_color,
          primary_image_url, sort_order, is_default, is_active
        ) VALUES (
          v_product_id,
          v_colorway_elem->>'color_name',
          v_colorway_elem->>'display_name',
          v_colorway_elem->>'hex_color',
          v_colorway_elem->>'primary_image_url',
          COALESCE((v_colorway_elem->>'sort_order')::integer, 0),
          (v_colorway_elem->>'color_name' = v_default_color_name),
          COALESCE((v_colorway_elem->>'is_active')::boolean, true)
        )
        RETURNING id INTO v_new_colorway_id;
      END IF;

      IF v_colorway_elem->>'color_name' = v_default_color_name THEN
        v_default_colorway_id := v_new_colorway_id;
      END IF;

      IF v_colorway_elem->'images' IS NOT NULL THEN
        DELETE FROM public.product_colorway_images WHERE colorway_id = v_new_colorway_id;

        v_sort_order := 0;
        FOR v_image_elem IN SELECT * FROM jsonb_array_elements(v_colorway_elem->'images') LOOP
          IF jsonb_typeof(v_image_elem) = 'object' THEN
            v_image_url := v_image_elem->>'image_url';
          ELSE
            v_image_url := v_image_elem#>>'{}';
          END IF;

          IF v_image_url IS NOT NULL AND v_image_url <> '' THEN
            INSERT INTO public.product_colorway_images (
              colorway_id, image_url, sort_order, alt_text, image_type
            ) VALUES (
              v_new_colorway_id,
              v_image_url,
              v_sort_order,
              CASE WHEN jsonb_typeof(v_image_elem) = 'object' THEN v_image_elem->>'alt_text' ELSE NULL END,
              CASE WHEN jsonb_typeof(v_image_elem) = 'object' THEN COALESCE(v_image_elem->>'image_type', 'gallery') ELSE 'gallery' END
            );
            v_sort_order := v_sort_order + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    IF v_default_colorway_id IS NOT NULL THEN
      UPDATE public.products
      SET default_colorway_id = v_default_colorway_id
      WHERE id = v_product_id;
    END IF;
  END IF;

  -- 5. Inventory Matrix Generation (INV-005)
  IF array_length(v_sizes, 1) > 0 THEN
    IF array_length(v_color_names, 1) IS NULL OR array_length(v_color_names, 1) = 0 THEN
      v_color_names := ARRAY[''];
    END IF;

    -- 5a. Check reservation guard before pruning
    SELECT string_agg(
      format('%s / %s (%s unit(s) reserved)', COALESCE(NULLIF(color, ''), 'Standard'), size, reserved),
      ', '
    )
    INTO v_reserved_conflict
    FROM public.inventory i
    WHERE i.product_doc_id = v_product_id
      AND i.deleted = false
      AND COALESCE(i.reserved, 0) > 0
      AND (
        NOT (i.size = ANY(v_sizes)) OR
        NOT (i.color = ANY(v_color_names))
      );

    IF v_reserved_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot remove variant(s) with active customer reservations: %', v_reserved_conflict
        USING ERRCODE = 'P0001';
    END IF;

    -- 5b. Upsert matrix combinations
    FOREACH v_size_elem IN ARRAY v_sizes LOOP
      FOREACH v_color_elem IN ARRAY v_color_names LOOP
        
        v_sku_str := v_style_code || '-' || upper(regexp_replace(v_color_elem, '\s+', '', 'g')) || '-' || v_size_elem;
        IF v_color_elem = '' THEN
          v_sku_str := v_style_code || '-' || v_size_elem;
        END IF;

        -- Check for existing active row
        SELECT id INTO v_existing_inv_id
        FROM public.inventory
        WHERE product_doc_id = v_product_id
          AND deleted = false
          AND size = v_size_elem
          AND color = v_color_elem
        LIMIT 1;

        IF v_existing_inv_id IS NOT NULL THEN
          -- Active variant exists, update non-stock metadata
          UPDATE public.inventory
          SET item = _product_payload->>'name',
              category = _product_payload->>'category',
              sku = v_style_code,
              updated_at = v_now
          WHERE id = v_existing_inv_id;
        ELSE
          -- Check if soft-deleted row exists to restore
          SELECT id INTO v_existing_inv_id
          FROM public.inventory
          WHERE product_doc_id = v_product_id
            AND deleted = true
            AND size = v_size_elem
            AND color = v_color_elem
          ORDER BY (total > 0) DESC, updated_at DESC
          LIMIT 1;

          IF v_existing_inv_id IS NOT NULL THEN
            UPDATE public.inventory
            SET deleted = false,
                item = _product_payload->>'name',
                category = _product_payload->>'category',
                sku = v_style_code,
                updated_at = v_now
            WHERE id = v_existing_inv_id;
          ELSE
            INSERT INTO public.inventory (
              product_doc_id, item, category, sku, size, color, pattern, variant_sku,
              total, reserved, available, deleted, created_at, updated_at
            ) VALUES (
              v_product_id,
              _product_payload->>'name',
              _product_payload->>'category',
              v_style_code,
              v_size_elem,
              v_color_elem,
              '',
              v_sku_str,
              0, 0, 0, false,
              v_now, v_now
            );
            v_variants_created := v_variants_created + 1;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    -- 5c. Soft-prune variants missing from matrix that have zero stock and zero reservations
    UPDATE public.inventory
    SET deleted = true,
        updated_at = v_now
    WHERE product_doc_id = v_product_id
      AND deleted = false
      AND (
        NOT (size = ANY(v_sizes)) OR 
        NOT (color = ANY(v_color_names))
      )
      AND (total = 0 OR total IS NULL)
      AND (reserved = 0 OR reserved IS NULL);
      
    -- 5d. Recalculate stock and status for parent product
    PERFORM public.sync_product_stock(v_product_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'default_colorway_id', v_default_colorway_id,
    'variants_created', v_variants_created
  );
END;
$function$;

-- Revoke from PUBLIC and anon, explicit grant to authenticated
REVOKE ALL ON FUNCTION public.upsert_product_with_colorways(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_with_colorways(jsonb, jsonb) TO authenticated;
