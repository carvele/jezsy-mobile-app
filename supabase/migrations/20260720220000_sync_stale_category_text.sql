-- ============================================================================
-- SYNC STALE products.category/sub_category AND inventory.category TEXT
-- ============================================================================
-- Context: 20260720200000 remapped every product's category_id to the new
-- taxonomy, but the mobile app currently reads category via the denormalized
-- TEXT columns (products.category / products.sub_category), not the FK --
-- see app/(tabs)/explore.tsx, index.tsx, product/[id].tsx, wishlist.tsx,
-- wardrobe.tsx, outfit-builder.tsx, GapAnalysis.tsx. Those columns were never
-- touched by the remap, so the live storefront is currently showing WRONG
-- category text for several products -- most visibly "White Simple Tee"
-- still reading the abandoned "Ball Gowns" category.
--
-- This is a stopgap, not the fix: it syncs the text columns to match
-- category_id so the storefront is correct again immediately, while the
-- mobile app's read path is migrated to query the FK directly (tracked
-- separately -- the text columns should be dropped once that ships, not
-- kept in sync via migrations indefinitely).
--
-- IDEMPOTENT: derives every value fresh from the current category_id join.
-- ============================================================================

BEGIN;

UPDATE public.products p
SET category = top.name,
    sub_category = sub.name
FROM public.categories sub
JOIN public.categories top ON top.id = sub.parent_id
WHERE sub.id = p.category_id;

UPDATE public.inventory i
SET category = top.name
FROM public.products p
JOIN public.categories sub ON sub.id = p.category_id
JOIN public.categories top ON top.id = sub.parent_id
WHERE i.product_doc_id = p.id;

COMMIT;
