-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- Exists live (ledger version 20260720041000, name backfill_inventory_rows)
-- with no file in this repo and no retrievable original SQL. This is a
-- one-time data backfill, not a schema change, so it is inherently
-- irreproducible exactly -- included here as a placeholder for historical
-- completeness only. It performs no action: the live data state it
-- produced already exists (verified: every active product with a sizes
-- array has matching inventory rows), so there is nothing to backfill
-- against current data, and this file intentionally does not attempt to
-- re-derive or re-run the original backfill logic.
--
-- DO NOT extend this file to perform inserts without first re-checking
-- live inventory/products state -- it is a no-op by design.

SELECT 1; -- intentional no-op placeholder; see header
