-- Migration: 20260917160000_recommend_size_rpc.sql
-- Description: Move size recommendation algorithm to Postgres for server-side 'My Size' filtering before pagination.

CREATE OR REPLACE FUNCTION public.to_numeric(val jsonb) RETURNS numeric AS $$
BEGIN
    IF val IS NULL OR jsonb_typeof(val) = 'null' THEN
        RETURN NULL;
    ELSIF jsonb_typeof(val) = 'number' THEN
        RETURN (val#>>'{}')::numeric;
    ELSIF jsonb_typeof(val) = 'object' AND val ? 'valueCm' THEN
        RETURN (val->>'valueCm')::numeric;
    ELSIF jsonb_typeof(val) = 'string' THEN
        BEGIN
            RETURN (val#>>'{}')::numeric;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.recommend_size(
    user_measurements jsonb,
    product_measurements jsonb,
    category text DEFAULT NULL,
    fit_preference text DEFAULT 'regular'
) RETURNS text AS $$
DECLARE
    u_bust numeric;
    u_waist numeric;
    u_hips numeric;
    u_inseam numeric;
    u_shoulder numeric;
    
    cat text;
    is_top_or_outerwear boolean;
    is_bottom boolean;
    is_dress boolean;
    
    allowance numeric := 2.0;
    
    best_size text := NULL;
    min_weighted_score numeric := 'Infinity'::numeric;
    
    k text;
    v jsonb;
    
    weighted_diff_sum numeric;
    total_weight numeric;
    strictly_too_small boolean;
    
    g_bust numeric;
    g_waist numeric;
    g_hips numeric;
    g_inseam numeric;
    g_shoulder numeric;
    
    weight numeric;
    target_val numeric;
    avg_score numeric;
BEGIN
    IF user_measurements IS NULL OR product_measurements IS NULL THEN
        RETURN NULL;
    END IF;
    
    u_bust := public.to_numeric(user_measurements->'bust');
    u_waist := public.to_numeric(user_measurements->'waist');
    u_hips := public.to_numeric(user_measurements->'hips');
    u_inseam := public.to_numeric(user_measurements->'inseam');
    u_shoulder := public.to_numeric(user_measurements->'shoulderWidth');
    
    IF u_bust IS NULL AND u_waist IS NULL AND u_hips IS NULL THEN
        RETURN NULL;
    END IF;
    
    cat := lower(COALESCE(category, ''));
    is_top_or_outerwear := cat LIKE '%top%' OR cat LIKE '%blazer%' OR cat LIKE '%jacket%' OR cat LIKE '%shirt%' OR cat LIKE '%outerwear%' OR cat LIKE '%bra%' OR cat LIKE '%activewear%';
    is_bottom := cat LIKE '%bottom%' OR cat LIKE '%pant%' OR cat LIKE '%jean%' OR cat LIKE '%skirt%' OR cat LIKE '%short%' OR cat LIKE '%trouser%';
    is_dress := cat LIKE '%dress%' OR cat LIKE '%jumpsuit%' OR cat LIKE '%romper%' OR cat LIKE '%gown%';
    
    IF fit_preference = 'tight' THEN allowance := 0.0; END IF;
    IF fit_preference = 'loose' THEN allowance := 5.0; END IF;
    
    IF is_top_or_outerwear AND (cat LIKE '%blazer%' OR cat LIKE '%jacket%' OR cat LIKE '%outerwear%') THEN
        allowance := allowance + 2.0;
    END IF;
    
    FOR k, v IN SELECT * FROM jsonb_each(product_measurements) LOOP
        weighted_diff_sum := 0.0;
        total_weight := 0.0;
        strictly_too_small := false;
        
        g_bust := public.to_numeric(v->'bust');
        g_waist := public.to_numeric(v->'waist');
        g_hips := public.to_numeric(v->'hips');
        g_inseam := public.to_numeric(v->'inseam');
        g_shoulder := public.to_numeric(v->'shoulderWidth');
        
        -- 1. Bust
        IF u_bust IS NOT NULL AND g_bust IS NOT NULL THEN
            IF is_bottom THEN weight := 0.0; ELSIF is_top_or_outerwear THEN weight := 1.0; ELSIF is_dress THEN weight := 1.0; ELSE weight := 0.8; END IF;
            IF weight > 0 THEN
                target_val := u_bust + allowance;
                IF g_bust < u_bust - 1.0 THEN strictly_too_small := true; END IF;
                weighted_diff_sum := weighted_diff_sum + (abs(g_bust - target_val) * weight);
                total_weight := total_weight + weight;
            END IF;
        END IF;
        
        -- 2. Waist
        IF u_waist IS NOT NULL AND g_waist IS NOT NULL THEN
            IF is_bottom THEN weight := 1.0; ELSIF is_dress THEN weight := 0.9; ELSIF is_top_or_outerwear THEN weight := 0.35; ELSE weight := 0.6; END IF;
            IF weight > 0 THEN
                target_val := u_waist + allowance;
                IF g_waist < u_waist - 1.0 AND is_bottom THEN strictly_too_small := true; END IF;
                weighted_diff_sum := weighted_diff_sum + (abs(g_waist - target_val) * weight);
                total_weight := total_weight + weight;
            END IF;
        END IF;
        
        -- 3. Hips
        IF u_hips IS NOT NULL AND g_hips IS NOT NULL THEN
            IF is_bottom THEN weight := 1.0; ELSIF is_dress THEN weight := 0.9; ELSIF is_top_or_outerwear THEN weight := 0.1; ELSE weight := 0.5; END IF;
            IF weight > 0 THEN
                target_val := u_hips + allowance;
                IF g_hips < u_hips - 1.0 AND (is_bottom OR is_dress) THEN strictly_too_small := true; END IF;
                weighted_diff_sum := weighted_diff_sum + (abs(g_hips - target_val) * weight);
                total_weight := total_weight + weight;
            END IF;
        END IF;
        
        -- 4. Inseam
        IF u_inseam IS NOT NULL AND g_inseam IS NOT NULL AND is_bottom THEN
            weight := 0.5;
            target_val := u_inseam;
            IF g_inseam < u_inseam - 3.0 THEN strictly_too_small := true; END IF;
            weighted_diff_sum := weighted_diff_sum + (abs(g_inseam - target_val) * weight);
            total_weight := total_weight + weight;
        END IF;
        
        -- 5. Shoulder
        IF u_shoulder IS NOT NULL AND g_shoulder IS NOT NULL AND is_top_or_outerwear THEN
            weight := 0.75;
            target_val := u_shoulder + (allowance * 0.5);
            IF g_shoulder < u_shoulder - 1.5 THEN strictly_too_small := true; END IF;
            weighted_diff_sum := weighted_diff_sum + (abs(g_shoulder - target_val) * weight);
            total_weight := total_weight + weight;
        END IF;
        
        IF NOT strictly_too_small AND total_weight > 0 THEN
            avg_score := weighted_diff_sum / total_weight;
            IF avg_score < min_weighted_score THEN
                min_weighted_score := avg_score;
                best_size := k;
            END IF;
        END IF;
    END LOOP;
    
    RETURN best_size;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop and recreate search_catalog with my_size_only and user_measurements
DROP FUNCTION IF EXISTS public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.search_catalog(
  search_query text DEFAULT NULL::text,
  category_ids text[] DEFAULT NULL::text[],
  size_filters text[] DEFAULT NULL::text[],
  color_filters text[] DEFAULT NULL::text[],
  fit_filters text[] DEFAULT NULL::text[],
  material_filters text[] DEFAULT NULL::text[],
  tag_filters text[] DEFAULT NULL::text[],
  on_sale_only boolean DEFAULT false,
  new_arrivals_only boolean DEFAULT false,
  ar_only boolean DEFAULT false,
  min_price numeric DEFAULT NULL::numeric,
  max_price numeric DEFAULT NULL::numeric,
  sort_by text DEFAULT 'recommended'::text,
  my_size_only boolean DEFAULT false,
  user_measurements jsonb DEFAULT NULL::jsonb
)
RETURNS SETOF public.products
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  SELECT p.*
  FROM public.products p
  WHERE p.visibility = 'public' AND p.deleted = false
    AND (
      (search_query IS NULL AND category_ids IS NULL) OR
      (search_query IS NOT NULL AND category_ids IS NULL AND p.name ILIKE '%' || search_query || '%') OR
      (search_query IS NULL AND category_ids IS NOT NULL AND p.category_id::text = ANY(category_ids)) OR
      (search_query IS NOT NULL AND category_ids IS NOT NULL AND (p.name ILIKE '%' || search_query || '%' OR p.category_id::text = ANY(category_ids)))
    )
    AND (size_filters IS NULL OR p.sizes && size_filters)
    AND (color_filters IS NULL OR 
      EXISTS (
        SELECT 1 FROM unnest(color_filters) AS c
        WHERE p.color ILIKE '%' || c || '%' OR p.base_color ILIKE '%' || c || '%'
      )
    )
    AND (fit_filters IS NULL OR 
      EXISTS (
        SELECT 1 FROM unnest(fit_filters) AS f
        WHERE p.fit_and_sizing ILIKE '%' || f || '%'
      )
    )
    AND (material_filters IS NULL OR 
      EXISTS (
        SELECT 1 FROM unnest(material_filters) AS m
        WHERE p.material ILIKE '%' || m || '%'
      )
    )
    AND (tag_filters IS NULL OR p.tags && tag_filters)
    AND (NOT on_sale_only OR p.on_sale = true)
    AND (NOT new_arrivals_only OR p.is_new_arrival = true)
    AND (NOT ar_only OR (p.model_3d_url IS NOT NULL AND 'AR Try-On' = ANY(p.tags)))
    AND (min_price IS NULL OR COALESCE(p.sale_price, p.price) >= min_price)
    AND (max_price IS NULL OR COALESCE(p.sale_price, p.price) <= max_price)
    AND (
      NOT my_size_only 
      OR (
        user_measurements IS NOT NULL 
        AND public.recommend_size(user_measurements, p.measurements, (SELECT name FROM public.categories c WHERE c.id = p.category_id LIMIT 1)) = ANY(p.sizes)
      )
    )
  ORDER BY
    CASE WHEN p.stock > 0 THEN 0 ELSE 1 END ASC,
    CASE WHEN sort_by = 'priceAsc' THEN COALESCE(p.sale_price, p.price) END ASC,
    CASE WHEN sort_by = 'priceDesc' THEN COALESCE(p.sale_price, p.price) END DESC,
    CASE WHEN sort_by = 'popular' THEN p.review_count END DESC,
    CASE WHEN sort_by = 'bestSelling' THEN public.get_product_sold_count(p.id) END DESC,
    CASE WHEN sort_by = 'rating' THEN p.rating END DESC,
    p.created_at DESC,
    p.id ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.to_numeric(jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.recommend_size(jsonb, jsonb, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text, boolean, jsonb) TO authenticated, anon;
