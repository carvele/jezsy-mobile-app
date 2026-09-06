-- Rollback for 20260720280000_ensure_categories_parent_fk.sql
-- Only meaningful if this migration actually created the constraint/column
-- (hypothesis (b) above) -- if it was a no-op (hypothesis (a), the expected
-- case), this rollback is also a no-op via the same guards.
--
-- NOT dropping parent_id itself: too destructive to reverse blindly given
-- the coworker's taxonomy work depends on it existing regardless of who
-- created it first. Only the FK this migration might have added is reverted.

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_parent_id_fkey;

NOTIFY pgrst, 'reload schema';
