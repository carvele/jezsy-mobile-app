-- Migration: Ensure categories.parent_id FK exists and reload PostgREST's cache
--
-- Error being fixed: PGRST200 "Searched for a foreign key relationship between
-- 'categories' and 'categories' using the hint 'categories_parent_id_fkey' ...
-- but no matches were found", from the nested self-join in
-- src/utils/categoryDisplay.ts (CATEGORY_SELECT), used by
-- app/(tabs)/index.tsx's fetchProducts.
--
-- EVIDENCE CONSIDERED BEFORE WRITING THIS: categories.parent_id is not new --
-- it's referenced across 5 migrations back to 2026-07-16. More importantly,
-- 20260720210000_retire_old_taxonomy.sql (already applied live) explicitly
-- documents and relies on "categories.parent_id itself (ON DELETE CASCADE)"
-- to cascade-delete subcategories when their parent is removed, and that
-- migration's own stated verification ("zero NULL, zero still on old tree")
-- would not hold if the constraint didn't exist and cascade. This strongly
-- suggests the FK is alive in Postgres and the real fault is PostgREST's
-- schema cache being stale after today's heavy DDL churn (multiple migration
-- batches from two contributors against the same live project), not a
-- genuinely missing constraint.
--
-- This migration is written to be correct under EITHER hypothesis:
--   (a) if the FK already exists, the guarded ADD CONSTRAINT is a no-op and
--       NOTIFY forces PostgREST to pick it back up -- this is the expected
--       path based on the evidence above.
--   (b) if the FK is somehow genuinely missing, this creates it exactly as
--       the query hint names it.
--
-- Column type matches categories.id (uuid) and is nullable -- top-level
-- categories have no parent. ON DELETE SET NULL rather than CASCADE would
-- change 20260720210000's already-verified cascade behavior, so CASCADE is
-- kept consistent with what that migration documents relying on.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'parent_id'
  ) THEN
    ALTER TABLE public.categories ADD COLUMN parent_id uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_parent_id_fkey'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
