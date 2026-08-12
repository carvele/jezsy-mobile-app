-- inventory.available had no CHECK constraint at all, unlike total/reserved
-- (inventory_nonnegative_check: total>=0, reserved>=0, reserved<=total).
-- Every writer (admin-dashboard Inventory.jsx edit/restock/sell,
-- productService.js, reservationService.js's adjustInventoryForReservation)
-- does an unguarded read-snapshot -> compute -> blind update with no
-- optimistic-concurrency check, so two concurrent writes on the same row can
-- race and corrupt available -- including driving it negative, since nothing
-- stopped that.
--
-- This does NOT fix the race itself (that needs atomic RPCs or row locking
-- across three call sites in the admin-dashboard repo -- an app-level
-- change, not attempted here without sign-off). It's a pure additive safety
-- net: confirmed zero live rows violate either invariant at the time this
-- was applied, so this only prevents future corruption, it does not change
-- behavior for any currently-valid row.
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_available_nonnegative_check CHECK (available >= 0);
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_available_matches_total_reserved_check CHECK (available = total - reserved);
