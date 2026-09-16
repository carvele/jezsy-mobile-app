-- Product -> Colorway -> Gallery Architecture Evolution
-- Migration: 20260916160000_create_product_colorways.sql

BEGIN;

-- 1. Create product_colorways table
CREATE TABLE IF NOT EXISTS public.product_colorways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  display_name TEXT,
  hex_color TEXT,
  primary_image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  legacy_product_id UUID UNIQUE REFERENCES public.products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index and unique constraints
CREATE INDEX IF NOT EXISTS idx_product_colorways_product_id ON public.product_colorways(product_id);
CREATE INDEX IF NOT EXISTS idx_product_colorways_legacy_id ON public.product_colorways(legacy_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_colorways_product_color 
  ON public.product_colorways(product_id, LOWER(TRIM(color_name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_colorways_single_default 
  ON public.product_colorways(product_id) WHERE is_default = true;

-- 2. Create product_colorway_images table
CREATE TABLE IF NOT EXISTS public.product_colorway_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colorway_id UUID NOT NULL REFERENCES public.product_colorways(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_text TEXT,
  image_type TEXT DEFAULT 'gallery',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_product_colorway_images_colorway_id ON public.product_colorway_images(colorway_id);
CREATE INDEX IF NOT EXISTS idx_product_colorway_images_sort ON public.product_colorway_images(colorway_id, sort_order ASC);

-- 3. Add default_colorway_id to public.products
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS default_colorway_id UUID REFERENCES public.product_colorways(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_default_colorway_id ON public.products(default_colorway_id);

-- 4. Triggers to enforce consistency between products.default_colorway_id and product_colorways.is_default
CREATE OR REPLACE FUNCTION public.sync_product_default_colorway()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.default_colorway_id IS DISTINCT FROM OLD.default_colorway_id THEN
    -- Clear is_default for old default colorway(s) of this product
    UPDATE public.product_colorways
    SET is_default = false
    WHERE product_id = NEW.id AND is_default = true;

    -- Set is_default for the new default colorway if provided
    IF NEW.default_colorway_id IS NOT NULL THEN
      UPDATE public.product_colorways
      SET is_default = true
      WHERE id = NEW.default_colorway_id AND product_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_default_colorway ON public.products;
CREATE TRIGGER trg_sync_product_default_colorway
  AFTER UPDATE OF default_colorway_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_default_colorway();

-- Trigger to maintain updated_at on product_colorways
CREATE OR REPLACE FUNCTION public.touch_product_colorway_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_product_colorway_updated_at ON public.product_colorways;
CREATE TRIGGER trg_touch_product_colorway_updated_at
  BEFORE UPDATE ON public.product_colorways
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_product_colorway_updated_at();

-- 5. Row Level Security (RLS) policies
ALTER TABLE public.product_colorways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_colorway_images ENABLE ROW LEVEL SECURITY;

-- Product colorways policies
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorways for active products" ON public.product_colorways;
CREATE POLICY "Allow anon and authenticated to view colorways for active products"
  ON public.product_colorways
  FOR SELECT
  TO public
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_colorways.product_id
        AND p.deleted = false
        AND (p.visibility = 'public' OR public.is_staff_or_admin())
    )
  );

DROP POLICY IF EXISTS "Allow staff/admin to manage product_colorways" ON public.product_colorways;
CREATE POLICY "Allow staff/admin to manage product_colorways"
  ON public.product_colorways
  FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- Product colorway images policies
DROP POLICY IF EXISTS "Allow anon and authenticated to view colorway images" ON public.product_colorway_images;
CREATE POLICY "Allow anon and authenticated to view colorway images"
  ON public.product_colorway_images
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.product_colorways cw
      JOIN public.products p ON p.id = cw.product_id
      WHERE cw.id = product_colorway_images.colorway_id
        AND cw.is_active = true
        AND p.deleted = false
        AND (p.visibility = 'public' OR public.is_staff_or_admin())
    )
  );

DROP POLICY IF EXISTS "Allow staff/admin to manage product_colorway_images" ON public.product_colorway_images;
CREATE POLICY "Allow staff/admin to manage product_colorway_images"
  ON public.product_colorway_images
  FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- 6. upsert_product_with_colorways transactional RPC
CREATE OR REPLACE FUNCTION public.upsert_product_with_colorways(
  _product_payload JSONB,
  _colorways_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
BEGIN
  -- Security guard: caller must be staff, admin, or service role
  IF auth.role() <> 'service_role' AND NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Access denied: staff or admin privileges required';
  END IF;

  -- 1. Validate payload
  IF _product_payload IS NULL THEN
    RAISE EXCEPTION 'Product payload cannot be null';
  END IF;

  IF _colorways_payload IS NULL OR jsonb_array_length(_colorways_payload) = 0 THEN
    RAISE EXCEPTION 'At least one colorway is required';
  END IF;

  -- 2. Inspect default colorways count
  FOR v_colorway_elem IN SELECT * FROM jsonb_array_elements(_colorways_payload) LOOP
    IF (v_colorway_elem->>'is_default')::boolean IS TRUE THEN
      v_default_count := v_default_count + 1;
      v_default_colorway := v_colorway_elem;
    END IF;
  END LOOP;

  IF v_default_count > 1 THEN
    RAISE EXCEPTION 'Only one default colorway can be designated';
  ELSIF v_default_count = 0 THEN
    -- Fall back to the first colorway in the payload
    v_default_colorway := _colorways_payload->0;
  END IF;

  v_default_color_name := v_default_colorway->>'color_name';

  -- Extract default colorway images for legacy products.images array sync
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

  -- Collect color names for legacy products.color string sync
  FOR v_colorway_elem IN SELECT * FROM jsonb_array_elements(_colorways_payload) LOOP
    v_color_names := array_append(v_color_names, v_colorway_elem->>'color_name');
  END LOOP;

  -- 3. Upsert parent product
  IF _product_payload->>'id' IS NOT NULL AND (_product_payload->>'id')::text <> '' THEN
    v_product_id := (_product_payload->>'id')::uuid;
    UPDATE public.products
    SET
      name = COALESCE(_product_payload->>'name', name),
      category = COALESCE(_product_payload->>'category', category),
      sub_category = COALESCE(_product_payload->>'sub_category', sub_category),
      price = COALESCE((_product_payload->>'price')::numeric, price),
      description = COALESCE(_product_payload->>'description', description),
      material = COALESCE(_product_payload->>'material', material),
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
      sizes = COALESCE(ARRAY(SELECT jsonb_array_elements_text(_product_payload->'sizes')), sizes),
      stock = COALESCE((_product_payload->>'stock')::integer, stock),
      tags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(_product_payload->'tags')), tags),
      pattern = COALESCE(_product_payload->>'pattern', pattern),
      -- Legacy dual-write fields
      base_color = COALESCE(v_default_color_name, base_color),
      color = array_to_string(v_color_names, ', '),
      image_url = COALESCE(v_default_colorway->>'primary_image_url', (v_default_images_array)[1], image_url),
      images = CASE WHEN array_length(v_default_images_array, 1) > 0 THEN v_default_images_array ELSE images END,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_product_id;
  ELSE
    INSERT INTO public.products (
      name, category, sub_category, price, description, material,
      care_instructions, fit_and_sizing, style_code, season, occasion,
      visibility, is_featured, is_new_arrival, is_alterable, on_sale,
      sale_price, discount_percentage, sizes, stock, tags, pattern,
      base_color, color, image_url, images
    ) VALUES (
      _product_payload->>'name',
      _product_payload->>'category',
      _product_payload->>'sub_category',
      (_product_payload->>'price')::numeric,
      _product_payload->>'description',
      _product_payload->>'material',
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
      ARRAY(SELECT jsonb_array_elements_text(_product_payload->'sizes')),
      COALESCE((_product_payload->>'stock')::integer, 0),
      ARRAY(SELECT jsonb_array_elements_text(_product_payload->'tags')),
      COALESCE(_product_payload->>'pattern', 'Solid'),
      v_default_color_name,
      array_to_string(v_color_names, ', '),
      COALESCE(v_default_colorway->>'primary_image_url', (v_default_images_array)[1]),
      v_default_images_array
    )
    RETURNING id INTO v_product_id;
  END IF;

  -- 4. Process colorways
  -- Clear existing is_default on product_colorways for this product to prevent unique index collisions
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
        updated_at = timezone('utc'::text, now())
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

    -- Upsert colorway images if present
    IF v_colorway_elem->'images' IS NOT NULL THEN
      -- Replace images for this colorway
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

  -- 5. Set authoritative default_colorway_id on parent product
  IF v_default_colorway_id IS NOT NULL THEN
    UPDATE public.products
    SET default_colorway_id = v_default_colorway_id
    WHERE id = v_product_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'default_colorway_id', v_default_colorway_id
  );
END;
$$;

-- Secure execution of upsert RPC
REVOKE ALL ON FUNCTION public.upsert_product_with_colorways(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_with_colorways(JSONB, JSONB) TO authenticated, service_role;

-- 7. backfill_canonical_sibling_colorways migration-only RPC
CREATE OR REPLACE FUNCTION public.backfill_canonical_sibling_colorways()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_group RECORD;
  v_sibling RECORD;
  v_standalone RECORD;
  v_colorway_id UUID;
  v_default_colorway_id UUID;
  v_image_url TEXT;
  v_sort_order INTEGER;
  v_colorways_created INTEGER := 0;
  v_images_created INTEGER := 0;
  v_products_consolidated INTEGER := 0;
  v_raw_color TEXT;
  v_primary_img TEXT;
BEGIN
  -- 1. Sibling Groups (style_code present on multiple products)
  FOR v_group IN
    SELECT style_code, MIN(id::text)::uuid AS canonical_id, COUNT(*) AS sibling_count
    FROM public.products
    WHERE style_code IS NOT NULL
      AND style_code <> ''
      AND deleted = false
    GROUP BY style_code
    HAVING COUNT(*) > 1
  LOOP
    v_default_colorway_id := NULL;

    FOR v_sibling IN
      SELECT id, name, base_color, color, image_url, images, created_at
      FROM public.products
      WHERE style_code = v_group.style_code
        AND deleted = false
      ORDER BY (id = v_group.canonical_id) DESC, created_at ASC
    LOOP
      v_raw_color := COALESCE(NULLIF(TRIM(v_sibling.base_color), ''), split_part(v_sibling.color, ',', 1), 'Standard');
      v_raw_color := TRIM(v_raw_color);

      -- Check if colorway already created for this canonical parent and color
      SELECT id INTO v_colorway_id
      FROM public.product_colorways
      WHERE product_id = v_group.canonical_id
        AND LOWER(TRIM(color_name)) = LOWER(v_raw_color);

      IF v_colorway_id IS NULL THEN
        -- Resolve primary image
        v_primary_img := COALESCE(v_sibling.image_url, (v_sibling.images)[1]);

        INSERT INTO public.product_colorways (
          product_id,
          color_name,
          display_name,
          primary_image_url,
          sort_order,
          is_default,
          is_active,
          legacy_product_id
        ) VALUES (
          v_group.canonical_id,
          v_raw_color,
          v_raw_color,
          v_primary_img,
          v_colorways_created,
          (v_sibling.id = v_group.canonical_id),
          true,
          v_sibling.id
        )
        RETURNING id INTO v_colorway_id;

        v_colorways_created := v_colorways_created + 1;

        IF v_sibling.id = v_group.canonical_id THEN
          v_default_colorway_id := v_colorway_id;
        END IF;

        -- Migrate images for this sibling into product_colorway_images
        v_sort_order := 0;
        IF v_sibling.images IS NOT NULL AND array_length(v_sibling.images, 1) > 0 THEN
          FOREACH v_image_url IN ARRAY v_sibling.images LOOP
            IF v_image_url IS NOT NULL AND v_image_url <> '' THEN
              INSERT INTO public.product_colorway_images (
                colorway_id, image_url, sort_order
              ) VALUES (
                v_colorway_id, v_image_url, v_sort_order
              );
              v_images_created := v_images_created + 1;
              v_sort_order := v_sort_order + 1;
            END IF;
          END LOOP;
        ELSIF v_sibling.image_url IS NOT NULL AND v_sibling.image_url <> '' THEN
          INSERT INTO public.product_colorway_images (
            colorway_id, image_url, sort_order
          ) VALUES (
            v_colorway_id, v_sibling.image_url, 0
          );
          v_images_created := v_images_created + 1;
        END IF;
      END IF;

      -- Coexistence contract: Legacy sibling products remain public so older apps can read them.
    END LOOP;

    -- Set canonical parent default_colorway_id
    IF v_default_colorway_id IS NOT NULL THEN
      UPDATE public.products
      SET default_colorway_id = v_default_colorway_id
      WHERE id = v_group.canonical_id;
    END IF;

    v_products_consolidated := v_products_consolidated + 1;
  END LOOP;

  -- 2. Standalone Products (single products or products with no siblings)
  FOR v_standalone IN
    SELECT p.id, p.name, p.base_color, p.color, p.image_url, p.images
    FROM public.products p
    WHERE p.deleted = false
      AND NOT EXISTS (
        SELECT 1 FROM public.product_colorways cw
        WHERE cw.product_id = p.id
           OR cw.legacy_product_id = p.id
      )
  LOOP
    v_raw_color := COALESCE(NULLIF(TRIM(v_standalone.base_color), ''), split_part(v_standalone.color, ',', 1), 'Standard');
    v_raw_color := TRIM(v_raw_color);
    v_primary_img := COALESCE(v_standalone.image_url, (v_standalone.images)[1]);

    INSERT INTO public.product_colorways (
      product_id,
      color_name,
      display_name,
      primary_image_url,
      sort_order,
      is_default,
      is_active,
      legacy_product_id
    ) VALUES (
      v_standalone.id,
      v_raw_color,
      v_raw_color,
      v_primary_img,
      0,
      true,
      true,
      v_standalone.id
    )
    RETURNING id INTO v_colorway_id;

    v_colorways_created := v_colorways_created + 1;

    UPDATE public.products
    SET default_colorway_id = v_colorway_id
    WHERE id = v_standalone.id;

    -- Migrate images
    v_sort_order := 0;
    IF v_standalone.images IS NOT NULL AND array_length(v_standalone.images, 1) > 0 THEN
      FOREACH v_image_url IN ARRAY v_standalone.images LOOP
        IF v_image_url IS NOT NULL AND v_image_url <> '' THEN
          INSERT INTO public.product_colorway_images (
            colorway_id, image_url, sort_order
          ) VALUES (
            v_colorway_id, v_image_url, v_sort_order
          );
          v_images_created := v_images_created + 1;
          v_sort_order := v_sort_order + 1;
        END IF;
      END LOOP;
    ELSIF v_standalone.image_url IS NOT NULL AND v_standalone.image_url <> '' THEN
      INSERT INTO public.product_colorway_images (
        colorway_id, image_url, sort_order
      ) VALUES (
        v_colorway_id, v_standalone.image_url, 0
      );
      v_images_created := v_images_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'colorways_created', v_colorways_created,
    'images_created', v_images_created,
    'sibling_groups_consolidated', v_products_consolidated
  );
END;
$$;

-- Migration/Service-Role execution only
REVOKE ALL ON FUNCTION public.backfill_canonical_sibling_colorways() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_canonical_sibling_colorways() TO service_role;

COMMIT;
