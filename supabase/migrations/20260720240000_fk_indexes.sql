-- Migration: Index the remaining unindexed foreign keys
--
-- DB_AUDIT_2026-07-20.md finding 11. Postgres does not auto-index FK columns;
-- an unindexed FK means every parent-side DELETE/UPDATE does a sequential scan
-- of the child table to enforce the constraint, and every join/filter on that
-- column does likewise.
--
-- The set below is the live unindexed-FK list re-queried at migration time
-- (pg_constraint vs pg_index first-column match), not the original audit list
-- -- messages, conversations, inventory and reviews were already indexed by
-- earlier migrations in this series and are correctly absent here.
--
-- All are single-column FKs, so a plain btree on the referencing column is
-- the right shape. Row counts are small today (largest is logs at 43), so
-- these are cheap now and prevent the cliff later.

CREATE INDEX IF NOT EXISTS idx_ar_assets_product_id ON public.ar_assets (product_id);
CREATE INDEX IF NOT EXISTS idx_ar_sessions_product_id ON public.ar_sessions (product_id);
CREATE INDEX IF NOT EXISTS idx_ar_sessions_user_id ON public.ar_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_capsule_items_wardrobe_item_id ON public.capsule_items (wardrobe_item_id);
CREATE INDEX IF NOT EXISTS idx_capsules_user_id ON public.capsules (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON public.logs (user_id);
CREATE INDEX IF NOT EXISTS idx_products_created_by ON public.products (created_by);
CREATE INDEX IF NOT EXISTS idx_products_updated_by ON public.products (updated_by);
CREATE INDEX IF NOT EXISTS idx_reservations_assigned_staff_id ON public.reservations (assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_reservations_staff_id ON public.reservations (staff_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product_id ON public.reservations (product_id);
CREATE INDEX IF NOT EXISTS idx_staff_status_history_staff_id ON public.staff_status_history (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_status_history_changed_by ON public.staff_status_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_product_id ON public.wardrobe_items (product_id);
