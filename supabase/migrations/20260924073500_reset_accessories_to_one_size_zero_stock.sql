-- Migration: 20260924073500_reset_accessories_to_one_size_zero_stock.sql
-- Description: Standardize all accessories to 'One Size' with 3 stock per variant to resolve sizing errors.
-- Creates backup tables _backup_accessory_inventory_20260924 and _backup_accessory_products_20260924 for zero-risk rollback.

-- 1. Create backup tables if they do not already exist
CREATE TABLE IF NOT EXISTS public._backup_accessory_inventory_20260924 (
  id uuid PRIMARY KEY,
  product_doc_id uuid,
  item text,
  color text,
  size text,
  available integer,
  total integer,
  reserved integer,
  deleted boolean,
  deleted_at timestamptz,
  variant_sku text,
  backed_up_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public._backup_accessory_products_20260924 (
  id uuid PRIMARY KEY,
  sizes text[],
  stock integer,
  status text,
  backed_up_at timestamptz DEFAULT now()
);

-- 2. Populate backups for all accessory products and inventory rows
INSERT INTO public._backup_accessory_products_20260924 (id, sizes, stock, status)
SELECT p.id, p.sizes, p.stock, p.status
FROM public.products p
WHERE (
  p.category_id IN (
    SELECT id FROM public.categories WHERE id = 'a1111111-1111-1111-1111-111111111111' OR parent_id = 'a1111111-1111-1111-1111-111111111111'
  ) OR p.category ILIKE '%accessor%'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public._backup_accessory_inventory_20260924 (
  id, product_doc_id, item, color, size, available, total, reserved, deleted, deleted_at, variant_sku
)
SELECT 
  inv.id, inv.product_doc_id, inv.item, inv.color, inv.size, inv.available, inv.total, inv.reserved, inv.deleted, inv.deleted_at, inv.variant_sku
FROM public.inventory inv
JOIN public._backup_accessory_products_20260924 bap ON bap.id = inv.product_doc_id
ON CONFLICT (id) DO NOTHING;

-- 3. Resolve redundant variants per (product_doc_id, color):
-- For products with multiple active rows for the same color, keep the One Size row (or 1st row) and soft-delete duplicate rows to prevent violating idx_inventory_unique_active_variant
WITH ranked_variants AS (
  SELECT 
    inv.id,
    ROW_NUMBER() OVER (
      PARTITION BY inv.product_doc_id, COALESCE(inv.color, '')
      ORDER BY 
        CASE WHEN inv.size = 'One Size' THEN 1 ELSE 2 END,
        inv.id ASC
    ) as rn
  FROM public.inventory inv
  JOIN public._backup_accessory_products_20260924 bap ON bap.id = inv.product_doc_id
  WHERE inv.deleted = false
)
UPDATE public.inventory
SET 
  deleted = true,
  deleted_at = COALESCE(deleted_at, now()),
  available = 0,
  total = 0,
  updated_at = now()
WHERE id IN (
  SELECT id FROM ranked_variants WHERE rn > 1
);

-- 4. Update the keeper active inventory rows:
-- Ensure size is 'One Size', stock is 3 (available = 3, total = 3, reserved = 0), and variant_sku reflects OS if necessary
WITH keeper_variants AS (
  SELECT 
    inv.id
  FROM public.inventory inv
  JOIN public._backup_accessory_products_20260924 bap ON bap.id = inv.product_doc_id
  WHERE inv.deleted = false
)
UPDATE public.inventory
SET 
  size = 'One Size',
  available = 3,
  total = 3,
  reserved = 0,
  variant_sku = CASE 
    WHEN variant_sku ~* '-(XS|S|M|L|XL)$' THEN REGEXP_REPLACE(variant_sku, '-(XS|S|M|L|XL)$', '-OS', 'i')
    ELSE variant_sku
  END,
  updated_at = now()
WHERE id IN (SELECT id FROM keeper_variants);

-- 5. Zero out stock on any deleted accessory inventory rows
UPDATE public.inventory
SET 
  available = 0,
  total = 0,
  reserved = 0,
  updated_at = now()
WHERE product_doc_id IN (SELECT id FROM public._backup_accessory_products_20260924)
  AND deleted = true
  AND (available != 0 OR total != 0 OR reserved != 0);

-- 6. Update products table for all accessories: set sizes to ['One Size']
UPDATE public.products
SET 
  sizes = ARRAY['One Size'],
  updated_at = now()
WHERE id IN (SELECT id FROM public._backup_accessory_products_20260924);

-- 7. Ensure all product stocks and status are synchronized
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT id FROM public._backup_accessory_products_20260924 LOOP
    PERFORM public.sync_product_stock(rec.id);
  END LOOP;
END $$;
