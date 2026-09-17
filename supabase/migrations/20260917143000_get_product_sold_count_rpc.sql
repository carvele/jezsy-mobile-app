-- Migration: 20260917143000_get_product_sold_count_rpc.sql
-- Description: Compute style-aggregated completed fulfilled units (excluding fully refunded reservations)

CREATE INDEX IF NOT EXISTS idx_products_style_code ON public.products(style_code) WHERE style_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_product_sold_count(p_product_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target_product AS (
    SELECT id, style_code
    FROM public.products
    WHERE id = p_product_id
  ),
  relevant_products AS (
    -- If style_code is present and non-empty, include all products sharing that style_code,
    -- including historical siblings that may have been soft-deleted/retired later.
    -- If no style_code, include only the target product itself.
    SELECT p.id
    FROM public.products p
    JOIN target_product tp ON (
      (tp.style_code IS NOT NULL AND tp.style_code <> '' AND p.style_code = tp.style_code)
      OR p.id = tp.id
    )
  )
  SELECT coalesce(sum(coalesce(ri.quantity, r.quantity, 1)), 0)::integer
  FROM public.reservations r
  LEFT JOIN public.reservation_items ri ON ri.reservation_id = r.id
  JOIN relevant_products rp ON rp.id = coalesce(ri.product_id, r.product_id)
  WHERE r.status = 'Completed'
    AND coalesce(r.payment_status, '') <> 'Refunded'
    AND coalesce(r.deleted, false) = false;
$$;

-- Explicit permissions: Allow anon and authenticated storefront visitors to query sold count
REVOKE ALL ON FUNCTION public.get_product_sold_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_sold_count(uuid) TO anon, authenticated, service_role;
