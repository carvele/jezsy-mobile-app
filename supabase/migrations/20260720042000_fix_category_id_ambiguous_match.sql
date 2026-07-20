-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- Exists live (ledger version 20260720042000, name
-- fix_category_id_ambiguous_match) with no file in this repo and no
-- retrievable original SQL. Likely a follow-up to
-- 20260720040000_add_products_category_fk.sql / 20260720041000, fixing a
-- backfill that matched products.category (text) to categories.name
-- ambiguously where multiple categories shared a name across different
-- parents.
--
-- This is a data-backfill migration and is not reproducible exactly. It is
-- a no-op placeholder for historical completeness: DB_TABLE_AUDIT_2026-07-20
-- found one active product ("Brown Dress") still has category_id NULL
-- despite a non-null category text, so whatever ambiguity this migration
-- fixed did not (or could not) resolve every row -- that gap is tracked as
-- DB_IMPLEMENTATION_PLAN.md Batch 4 item 4c, not fixed here.

SELECT 1; -- intentional no-op placeholder; see header
