-- ============================================================================
-- Migration: 20260915140000_repair_inventory_skus_and_style_codes.sql
-- Description: Repair invalid and missing style codes on products and inventory rows.
--              Eliminate raw database UUIDs and legacy seed collisions from the SKU matrix.
-- Author: Platform Team
-- Date: 2026-09-15
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 0: Create Backup Tables for Auditability and Safe Rollback
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _backup_product_style_codes_20260915 (
    product_id UUID PRIMARY KEY,
    old_style_code TEXT,
    new_style_code TEXT,
    remediated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _backup_sku_remediation_20260915 (
    inventory_id UUID PRIMARY KEY,
    product_id UUID,
    old_sku TEXT,
    old_variant_sku TEXT,
    new_sku TEXT,
    new_variant_sku TEXT,
    remediated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Step 1: Repair Products Missing style_code
-- ----------------------------------------------------------------------------

-- 1a. Adopt existing valid JZ-* SKU from inventory rows where products.style_code was NULL/empty
INSERT INTO _backup_product_style_codes_20260915 (product_id, old_style_code, new_style_code)
SELECT p.id, p.style_code, sub.clean_sku
FROM products p
JOIN (
    SELECT product_doc_id, min(sku) AS clean_sku
    FROM inventory
    WHERE sku IS NOT NULL
      AND trim(sku) != ''
      AND sku !~* '^[0-9a-f]{8}-[0-9a-f]{4}'
      AND sku LIKE 'JZ-%'
    GROUP BY product_doc_id
) sub ON sub.product_doc_id = p.id
WHERE p.style_code IS NULL OR trim(p.style_code) = '' OR p.style_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}'
ON CONFLICT (product_id) DO UPDATE
SET new_style_code = EXCLUDED.new_style_code;

UPDATE products p
SET style_code = b.new_style_code,
    updated_at = NOW()
FROM _backup_product_style_codes_20260915 b
WHERE p.id = b.product_id
  AND (p.style_code IS NULL OR trim(p.style_code) = '' OR p.style_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}');

-- 1b. Assign canonical unique style codes to known seed/legacy products
INSERT INTO _backup_product_style_codes_20260915 (product_id, old_style_code, new_style_code)
VALUES
    ('b0000001-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000001-0000-4000-8000-000000000001'), 'JZ-WT-1001'),
    ('b0000001-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000001-0000-4000-8000-000000000002'), 'JZ-LB-1002'),
    ('b0000002-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000002-0000-4000-8000-000000000001'), 'JZ-SB-1003'),
    ('b0000002-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000002-0000-4000-8000-000000000002'), 'JZ-HL-1004'),
    ('b0000003-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000003-0000-4000-8000-000000000001'), 'JZ-SJ-1005'),
    ('b0000003-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000003-0000-4000-8000-000000000002'), 'JZ-BL-1006'),
    ('b0000005-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000005-0000-4000-8000-000000000001'), 'JZ-ES-1007'),
    ('b0000005-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000005-0000-4000-8000-000000000002'), 'JZ-AB-1008'),
    ('b0000006-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000006-0000-4000-8000-000000000001'), 'JZ-RC-1009'),
    ('b0000006-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000006-0000-4000-8000-000000000002'), 'JZ-OH-1010'),
    ('b0000007-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000007-0000-4000-8000-000000000001'), 'JZ-CP-1011'),
    ('b0000007-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000007-0000-4000-8000-000000000002'), 'JZ-LS-1012'),
    ('b0000008-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000008-0000-4000-8000-000000000001'), 'JZ-BJ-1013'),
    ('b0000008-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000008-0000-4000-8000-000000000002'), 'JZ-TB-1014'),
    ('b0000009-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b0000009-0000-4000-8000-000000000001'), 'JZ-SB-1015'),
    ('b0000009-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b0000009-0000-4000-8000-000000000002'), 'JZ-CT-1016'),
    ('b000000a-0000-4000-8000-000000000001', (SELECT style_code FROM products WHERE id = 'b000000a-0000-4000-8000-000000000001'), 'JZ-EB-1017'),
    ('b000000a-0000-4000-8000-000000000002', (SELECT style_code FROM products WHERE id = 'b000000a-0000-4000-8000-000000000002'), 'JZ-SS-1018'),
    ('14f7f607-d281-4730-a5b9-5a71af63f849', (SELECT style_code FROM products WHERE id = '14f7f607-d281-4730-a5b9-5a71af63f849'), 'JZ-AS-1019')
ON CONFLICT (product_id) DO UPDATE
SET new_style_code = EXCLUDED.new_style_code;

UPDATE products p
SET style_code = b.new_style_code,
    updated_at = NOW()
FROM _backup_product_style_codes_20260915 b
WHERE p.id = b.product_id;

-- 1c. Deterministic fallback for any remaining products still missing style_code
WITH missing_prods AS (
    SELECT id, name,
           'JZ-' || upper(regexp_replace(coalesce(nullif(trim(name), ''), 'ITM'), '[^A-Za-z0-9]+', '', 'g')) AS raw_prefix
    FROM products
    WHERE style_code IS NULL OR trim(style_code) = '' OR style_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}'
)
INSERT INTO _backup_product_style_codes_20260915 (product_id, old_style_code, new_style_code)
SELECT m.id,
       (SELECT style_code FROM products WHERE id = m.id),
       substring(m.raw_prefix from 1 for 6) || '-' || (1000 + abs(hashtext(m.id::text)) % 9000)::text
FROM missing_prods m
ON CONFLICT (product_id) DO UPDATE
SET new_style_code = EXCLUDED.new_style_code;

UPDATE products p
SET style_code = b.new_style_code,
    updated_at = NOW()
FROM _backup_product_style_codes_20260915 b
WHERE p.id = b.product_id
  AND (p.style_code IS NULL OR trim(p.style_code) = '' OR p.style_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}');

-- ----------------------------------------------------------------------------
-- Step 2: Repair Inventory Rows
-- ----------------------------------------------------------------------------

-- Helper expression for normalized size:
-- 'One Size' / 'onesize' -> 'OS', otherwise uppercase alphanumeric
-- Helper expression for normalized color:
-- 'Dark Brown' -> 'DARK-BROWN', 'rust / orange' -> 'RUST-ORANGE'

INSERT INTO _backup_sku_remediation_20260915 (inventory_id, product_id, old_sku, old_variant_sku, new_sku, new_variant_sku)
SELECT
    i.id AS inventory_id,
    i.product_doc_id AS product_id,
    i.sku AS old_sku,
    i.variant_sku AS old_variant_sku,
    p.style_code AS new_sku,
    p.style_code ||
    CASE
        WHEN coalesce(trim(i.color), '') != ''
        THEN '-' || regexp_replace(regexp_replace(upper(trim(i.color)), '[\s/]+', '-', 'g'), '[^A-Z0-9-]', '', 'g')
        ELSE ''
    END ||
    CASE
        WHEN coalesce(trim(i.size), '') != ''
        THEN '-' || CASE
            WHEN lower(trim(i.size)) IN ('one size', 'onesize', 'os') THEN 'OS'
            WHEN lower(trim(i.size)) IN ('extra small', 'xs') THEN 'XS'
            WHEN lower(trim(i.size)) IN ('small', 's') THEN 'S'
            WHEN lower(trim(i.size)) IN ('medium', 'm') THEN 'M'
            WHEN lower(trim(i.size)) IN ('large', 'l') THEN 'L'
            WHEN lower(trim(i.size)) IN ('extra large', 'x-large', 'xl') THEN 'XL'
            WHEN lower(trim(i.size)) IN ('2x-large', 'xx-large', 'xxl', '2xl') THEN '2XL'
            WHEN lower(trim(i.size)) IN ('3x-large', 'xxxl', '3xl') THEN '3XL'
            ELSE regexp_replace(upper(trim(i.size)), '[^A-Z0-9-]', '', 'g')
        END
        ELSE ''
    END AS new_variant_sku
FROM inventory i
JOIN products p ON p.id = i.product_doc_id
WHERE
    -- Missing or invalid sku
    i.sku IS NULL
    OR trim(i.sku) = ''
    OR i.sku ~* '^[0-9a-f]{8}-[0-9a-f]{4}'
    OR i.sku = i.product_doc_id::text
    OR i.sku = i.id::text
    -- Missing or invalid variant_sku
    OR i.variant_sku IS NULL
    OR trim(i.variant_sku) = ''
    OR i.variant_sku ~* '^[0-9a-f]{8}-[0-9a-f]{4}'
    -- Legacy seed collision rows that need canonical reassignment
    OR (i.sku LIKE 'SEED-%' AND p.style_code LIKE 'JZ-%')
ON CONFLICT (inventory_id) DO UPDATE
SET new_sku = EXCLUDED.new_sku,
    new_variant_sku = EXCLUDED.new_variant_sku;

-- Apply the repaired SKUs to the inventory table
UPDATE inventory i
SET sku = b.new_sku,
    variant_sku = b.new_variant_sku,
    updated_at = NOW()
FROM _backup_sku_remediation_20260915 b
WHERE i.id = b.inventory_id;

-- ----------------------------------------------------------------------------
-- Step 3: Verification & Invariant Assertions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_bad_sku_count INT;
    v_uuid_sku_count INT;
    v_dup_variant_sku_count INT;
    v_remediated_rows INT;
BEGIN
    SELECT count(*) INTO v_remediated_rows FROM _backup_sku_remediation_20260915;
    RAISE NOTICE 'SKU remediation completed. Repaired % inventory rows.', v_remediated_rows;

    -- Assert 0 empty SKUs in inventory
    SELECT count(*) INTO v_bad_sku_count
    FROM inventory
    WHERE sku IS NULL OR trim(sku) = '' OR variant_sku IS NULL OR trim(variant_sku) = '';

    IF v_bad_sku_count > 0 THEN
        RAISE EXCEPTION 'Assertion failed: % inventory rows still have empty sku or variant_sku', v_bad_sku_count;
    END IF;

    -- Assert 0 UUID SKUs in inventory
    SELECT count(*) INTO v_uuid_sku_count
    FROM inventory
    WHERE sku ~* '^[0-9a-f]{8}-[0-9a-f]{4}' OR variant_sku ~* '^[0-9a-f]{8}-[0-9a-f]{4}';

    IF v_uuid_sku_count > 0 THEN
        RAISE EXCEPTION 'Assertion failed: % inventory rows still have UUID sku or variant_sku', v_uuid_sku_count;
    END IF;

    -- Assert 0 duplicate variant_skus among active rows
    SELECT count(*) INTO v_dup_variant_sku_count
    FROM (
        SELECT variant_sku
        FROM inventory
        WHERE deleted IS NOT TRUE
        GROUP BY variant_sku
        HAVING count(*) > 1
    ) dups;

    IF v_dup_variant_sku_count > 0 THEN
        RAISE EXCEPTION 'Assertion failed: % duplicate variant_skus found among active inventory rows', v_dup_variant_sku_count;
    END IF;

    RAISE NOTICE 'All SKU invariant assertions passed successfully.';
END $$;
