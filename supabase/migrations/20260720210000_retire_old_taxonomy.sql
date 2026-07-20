-- ============================================================================
-- RETIRE THE OLD TAXONOMY
-- ============================================================================
-- Context: final step of the taxonomy cutover. Verified before writing this:
--   * All 21 products (active + archived) now have category_id pointing at
--     the new tree (20260720200000) -- zero NULL, zero still on the old tree.
--   * The only foreign keys referencing categories.id are products.category_id
--     (already clear of the old tree) and categories.parent_id itself
--     (ON DELETE CASCADE), so deleting the 6 old top-level rows safely
--     cascades to their subcategories with nothing left dangling.
--
-- Deletes the old 6-main/22-sub tree (28 rows total, including categories
-- added ad hoc after the original seed: Leggings, Belts, Jewelry, Scarves,
-- Hats/Caps), then drops the temporary "-new" slug suffix on the 4 new
-- top-level categories that collided with old slugs (tops, bottoms,
-- outerwear, accessories), handing them the clean final slug now that
-- nothing else holds it.
-- ============================================================================

BEGIN;

DELETE FROM public.categories
WHERE id IN (
  '11111111-1111-1111-1111-111111111111', -- Tops
  '22222222-2222-2222-2222-222222222222', -- Bottoms
  '33333333-3333-3333-3333-333333333333', -- Outerwear
  '44444444-4444-4444-4444-444444444444', -- Dresses
  '55555555-5555-5555-5555-555555555555', -- Innerwear & Lounge
  '66666666-6666-6666-6666-666666666666'  -- Accessories
);
-- ON DELETE CASCADE on categories.parent_id removes all remaining
-- subcategories of these 6 rows automatically.

UPDATE public.categories SET slug = 'tops'         WHERE id = 'a9999999-9999-9999-9999-999999999999';
UPDATE public.categories SET slug = 'bottoms'      WHERE id = 'a3333333-3333-3333-3333-333333333333';
UPDATE public.categories SET slug = 'outerwear'    WHERE id = 'a8888888-8888-8888-8888-888888888888';
UPDATE public.categories SET slug = 'accessories'  WHERE id = 'a1111111-1111-1111-1111-111111111111';

COMMIT;
