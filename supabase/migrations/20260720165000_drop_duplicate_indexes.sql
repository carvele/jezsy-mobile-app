-- Migration: Drop duplicate indexes
--
-- orders.display_id and wishlists (user_id, product_id) each carry two
-- identical unique indexes, an artifact of the migration-ledger drift
-- (DB_AUDIT_2026-07-20.md finding 3) applying equivalent constraints twice
-- under different names. Keeping the original-named constraint from each
-- table's earliest migration; dropping the later duplicate.

DROP INDEX IF EXISTS public.orders_display_id_uidx;
DROP INDEX IF EXISTS public.wishlists_user_product_uidx;
