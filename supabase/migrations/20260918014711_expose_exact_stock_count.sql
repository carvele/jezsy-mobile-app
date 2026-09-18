-- Migration: Expose exact per-variant stock count to customers
-- Description:
--   product_variants was deliberately boolean-only (is_available, is_low_stock,
--   stock_status) to block scraping/business-intelligence inference of sales
--   velocity (see 20260914220000_progressive_auth_sanitized_projections.sql).
--   Product decision: show the real remaining count instead of a qualitative
--   hint. Adds i.available as a plain integer column on the same view; no RLS
--   change on the underlying inventory table (it stays staff/admin/owner only,
--   this view remains the only anon/authenticated-readable projection of it).
--   Column is appended last -- CREATE OR REPLACE VIEW treats an inserted
--   column in the middle of the list as a rename of the existing column that
--   shifts into its position, which Postgres rejects.

CREATE OR REPLACE VIEW public.product_variants AS
SELECT
  i.id,
  i.product_doc_id,
  i.sku,
  i.size,
  i.color,
  i.hex_color,
  i.pattern,
  (i.available > 0) AS is_available,
  (i.available > 0 AND i.available <= 3) AS is_low_stock,
  CASE
    WHEN i.available <= 0 THEN 'sold_out'
    WHEN i.available <= 3 THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status,
  i.available
FROM public.inventory i
JOIN public.products p ON p.id = i.product_doc_id
WHERE i.deleted = false
  AND p.deleted = false
  AND p.visibility = 'public';

ALTER VIEW public.product_variants OWNER TO postgres;
GRANT SELECT ON public.product_variants TO anon, authenticated;
