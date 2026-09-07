-- ============================================================================
-- Migration: Auto-sync products.category_id from category hierarchy
--
-- Objective:
-- Ensure public.products.category_id always points to the canonical
-- subcategory/category UUID matching the product's taxonomy, whether created
-- or edited from Admin Dashboard, scripts, or migrations.
--
-- Contract:
-- 1. Canonical source of truth: products.category_id -> categories.id.
-- 2. Subcategories are resolved using BOTH subcategory name and parent category name.
-- 3. Stale/conflicting category_id values on update are corrected to match taxonomy.
-- 4. Idempotent and safe against recursion.
-- 5. search_catalog RPC includes defensive fallback strictly when category_id IS NULL.
-- ============================================================================

-- 1. Trigger Function
CREATE OR REPLACE FUNCTION public.sync_product_category_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_matching_count integer;
  v_resolved_id uuid;
  v_is_current_valid boolean := false;
BEGIN
  -- Check if supplied category_id is already valid for current category + sub_category
  IF NEW.category_id IS NOT NULL THEN
    IF NEW.sub_category IS NOT NULL AND trim(NEW.sub_category) <> '' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.categories c
        JOIN public.categories p ON p.id = c.parent_id
        WHERE c.id = NEW.category_id
          AND lower(trim(c.name)) = lower(trim(NEW.sub_category))
          AND (NEW.category IS NULL OR trim(NEW.category) = '' OR lower(trim(p.name)) = lower(trim(NEW.category)))
      ) INTO v_is_current_valid;
    ELSIF NEW.category IS NOT NULL AND trim(NEW.category) <> '' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.categories c
        WHERE c.id = NEW.category_id
          AND c.parent_id IS NULL
          AND lower(trim(c.name)) = lower(trim(NEW.category))
      ) INTO v_is_current_valid;
    END IF;

    -- If the current category_id is valid for the taxonomy, preserve it
    IF v_is_current_valid THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Resolution step A: Match by subcategory name AND parent category name
  IF NEW.sub_category IS NOT NULL AND trim(NEW.sub_category) <> '' THEN
    SELECT count(*), min(c.id)
    INTO v_matching_count, v_resolved_id
    FROM public.categories c
    JOIN public.categories p ON p.id = c.parent_id
    WHERE lower(trim(c.name)) = lower(trim(NEW.sub_category))
      AND (NEW.category IS NULL OR trim(NEW.category) = '' OR lower(trim(p.name)) = lower(trim(NEW.category)));

    IF v_matching_count = 1 THEN
      NEW.category_id := v_resolved_id;
      RETURN NEW;
    ELSIF v_matching_count > 1 THEN
      -- Ambiguous match across parents: do not guess arbitrarily
      RAISE WARNING 'Ambiguous subcategory match for sub_category=% category=%', NEW.sub_category, NEW.category;
      RETURN NEW;
    END IF;
  END IF;

  -- Resolution step B: Fallback to parent category only if no subcategory was specified
  IF (NEW.sub_category IS NULL OR trim(NEW.sub_category) = '')
     AND NEW.category IS NOT NULL AND trim(NEW.category) <> '' THEN
    SELECT count(*), min(c.id)
    INTO v_matching_count, v_resolved_id
    FROM public.categories c
    WHERE c.parent_id IS NULL
      AND lower(trim(c.name)) = lower(trim(NEW.category));

    IF v_matching_count = 1 THEN
      NEW.category_id := v_resolved_id;
      RETURN NEW;
    ELSIF v_matching_count > 1 THEN
      RAISE WARNING 'Ambiguous parent category match for category=%', NEW.category;
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Trigger Attachment
DROP TRIGGER IF EXISTS trg_sync_product_category_id ON public.products;
CREATE TRIGGER trg_sync_product_category_id
BEFORE INSERT OR UPDATE OF category, sub_category, category_id ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_category_id();

-- 3. Idempotent Data Backfill for existing NULL category_id rows
UPDATE public.products p
SET category_id = sub.id
FROM public.categories sub
JOIN public.categories parent ON parent.id = sub.parent_id
WHERE p.category_id IS NULL
  AND p.deleted = false
  AND p.sub_category IS NOT NULL
  AND trim(p.sub_category) <> ''
  AND lower(trim(sub.name)) = lower(trim(p.sub_category))
  AND lower(trim(parent.name)) = lower(trim(p.category));

-- Fallback backfill for any row with only parent category
UPDATE public.products p
SET category_id = parent.id
FROM public.categories parent
WHERE p.category_id IS NULL
  AND p.deleted = false
  AND (p.sub_category IS NULL OR trim(p.sub_category) = '')
  AND p.category IS NOT NULL
  AND parent.parent_id IS NULL
  AND lower(trim(parent.name)) = lower(trim(p.category));

-- 4. search_catalog RPC with defensive fallback strictly when category_id IS NULL
CREATE OR REPLACE FUNCTION public.search_catalog(
  search_query text DEFAULT NULL,
  category_ids text[] DEFAULT NULL,
  size_filters text[] DEFAULT NULL,
  color_filters text[] DEFAULT NULL,
  fit_filters text[] DEFAULT NULL,
  material_filters text[] DEFAULT NULL,
  tag_filters text[] DEFAULT NULL,
  on_sale_only boolean DEFAULT false,
  new_arrivals_only boolean DEFAULT false,
  ar_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL,
  max_price numeric DEFAULT NULL,
  sort_by text DEFAULT 'recommended'
)
RETURNS SETOF public.products
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $BODY$
  SELECT p.*
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.deleted = false
    AND p.visibility = 'public'
    -- Category filter: canonical category_id comparison, with strict fallback ONLY when category_id is NULL
    AND (
      category_ids IS NULL 
      OR cardinality(category_ids) = 0 
      OR p.category_id::text = ANY(category_ids)
      OR (
        p.category_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.categories sub
          JOIN public.categories parent ON parent.id = sub.parent_id
          WHERE sub.id::text = ANY(category_ids)
            AND lower(trim(sub.name)) = lower(trim(p.sub_category))
            AND lower(trim(parent.name)) = lower(trim(p.category))
        )
      )
    )
    -- Text search filter across product name and category name
    AND (
      search_query IS NULL 
      OR trim(search_query) = ''
      OR p.name ILIKE '%' || trim(search_query) || '%'
      OR c.name ILIKE '%' || trim(search_query) || '%'
    )
    -- On sale filter
    AND (NOT on_sale_only OR p.on_sale = true)
    -- New arrivals filter (within 30 days)
    AND (NOT new_arrivals_only OR p.is_new_arrival = true OR p.created_at >= (NOW() - INTERVAL '30 days'))
    -- AR filter
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    -- Price filters
    AND (
      min_price IS NULL 
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) >= min_price
    )
    -- Price max filter
    AND (
      max_price IS NULL 
      OR COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) <= max_price
    )
    -- Size filter (array overlap)
    AND (size_filters IS NULL OR cardinality(size_filters) = 0 OR p.sizes && size_filters)
    -- Color filter
    AND (
      color_filters IS NULL 
      OR cardinality(color_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(color_filters) AS cf
        WHERE p.color ILIKE '%' || trim(cf) || '%' OR p.base_color ILIKE '%' || trim(cf) || '%'
      )
    )
    -- Fit filter
    AND (
      fit_filters IS NULL 
      OR cardinality(fit_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(fit_filters) AS ff
        WHERE p.fit_and_sizing ILIKE '%' || trim(ff) || '%'
      )
    )
    -- Material filter
    AND (
      material_filters IS NULL 
      OR cardinality(material_filters) = 0 
      OR EXISTS (
        SELECT 1 FROM unnest(material_filters) AS mf
        WHERE p.material ILIKE '%' || trim(mf) || '%'
      )
    )
    -- Tag filter
    AND (tag_filters IS NULL OR cardinality(tag_filters) = 0 OR p.tags && tag_filters)
  ORDER BY
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(CASE WHEN p.on_sale AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END, 0) END DESC,
    CASE WHEN sort_by = 'rating' THEN COALESCE(p.rating, 0) END DESC,
    CASE WHEN sort_by = 'popular' THEN COALESCE(p.review_count, 0) END DESC,
    p.created_at DESC,
    p.id ASC;
$BODY$;

GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text) TO anon;
