-- ============================================================================
-- SEED THE NEW 10-CATEGORY TAXONOMY (ADDITIVE ONLY)
-- ============================================================================
-- Context: replacing the 6-main/~20-sub taxonomy with a 10-main/45-sub one
-- (Accessories, Activewear, Bottoms, Dresses & Jumpsuits, Footwear,
-- Knitwear/Layering, Loungewear & sleepwear, Outerwear, Tops,
-- Underwear/Intimates). This migration ONLY inserts the new tree — it does
-- not touch products, does not remap anything, and does not delete the old
-- categories. Both apps keep reading the old tree exactly as before; nothing
-- changes for a live user until the follow-up remap migration runs.
--
-- Slugs: 4 new top-level names collide with existing live slugs ('tops',
-- 'bottoms', 'outerwear', 'accessories' are still in use by the old rows).
-- New rows use a temporary "-new" slug suffix; the Phase 3 migration drops
-- the old rows and then strips this suffix to hand the clean slug over.
--
-- Images: reused verbatim from the existing taxonomy wherever the new
-- category is a clean conceptual continuation of an old one (17 of 45 subs,
-- 6 of 10 mains). Left NULL everywhere else rather than guessing a new
-- Unsplash photo — genuinely new categories (Activewear, Footwear,
-- Knitwear/Layering, Underwear/Intimates, and most of their subs) need real
-- photography, not a placeholder chosen at random. The admin dashboard's
-- category editor now supports uploading a Cloudinary image for any category
-- (see admin-dashboard AdminInventoryPanel.jsx), so these can be filled in
-- directly instead of via another migration.
--
-- IDEMPOTENT: ON CONFLICT (id) DO NOTHING — safe to re-run.
-- ============================================================================

BEGIN;

-- ── Main categories ─────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Accessories',            'accessories-new',        NULL, 'https://images.unsplash.com/photo-1576053139778-7e32f2ae3cf4?w=600', 1),
  ('a2222222-2222-2222-2222-222222222222', 'Activewear',             'activewear',             NULL, NULL, 2),
  ('a3333333-3333-3333-3333-333333333333', 'Bottoms',                'bottoms-new',            NULL, 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600', 3),
  ('a4444444-4444-4444-4444-444444444444', 'Dresses & Jumpsuits',    'dresses-jumpsuits',      NULL, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600', 4),
  ('a5555555-5555-5555-5555-555555555555', 'Footwear',               'footwear',               NULL, NULL, 5),
  ('a6666666-6666-6666-6666-666666666666', 'Knitwear / Layering',    'knitwear-layering',      NULL, NULL, 6),
  ('a7777777-7777-7777-7777-777777777777', 'Loungewear & Sleepwear', 'loungewear-sleepwear',   NULL, 'https://images.unsplash.com/photo-1508609312543-70e1766f153f?w=600', 7),
  ('a8888888-8888-8888-8888-888888888888', 'Outerwear',              'outerwear-new',          NULL, 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600', 8),
  ('a9999999-9999-9999-9999-999999999999', 'Tops',                   'tops-new',               NULL, 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600', 9),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Underwear / Intimates',  'underwear-intimates',    NULL, NULL, 10)
ON CONFLICT (id) DO NOTHING;

-- ── 1. Accessories ───────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a1111111-0000-0000-0000-000000000001', 'Bags',      'accessories-bags',      'a1111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500', 1),
  ('a1111111-0000-0000-0000-000000000002', 'Hats / caps','accessories-hats',     'a1111111-1111-1111-1111-111111111111', NULL, 2),
  ('a1111111-0000-0000-0000-000000000003', 'Scarves',   'accessories-scarves',   'a1111111-1111-1111-1111-111111111111', NULL, 3),
  ('a1111111-0000-0000-0000-000000000004', 'Belts',     'accessories-belts',     'a1111111-1111-1111-1111-111111111111', NULL, 4),
  ('a1111111-0000-0000-0000-000000000005', 'Jewelry',   'accessories-jewelry',   'a1111111-1111-1111-1111-111111111111', NULL, 5)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Activewear ────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a2222222-0000-0000-0000-000000000001', 'Sports bras',            'activewear-sports-bras',      'a2222222-2222-2222-2222-222222222222', NULL, 1),
  ('a2222222-0000-0000-0000-000000000002', 'Leggings / biker shorts','activewear-leggings',         'a2222222-2222-2222-2222-222222222222', NULL, 2),
  ('a2222222-0000-0000-0000-000000000003', 'Training tops',          'activewear-training-tops',    'a2222222-2222-2222-2222-222222222222', NULL, 3),
  ('a2222222-0000-0000-0000-000000000004', 'Running shorts',         'activewear-running-shorts',   'a2222222-2222-2222-2222-222222222222', NULL, 4)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Bottoms ───────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a3333333-0000-0000-0000-000000000001', 'Pants / trousers', 'bottoms-pants',    'a3333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=500', 1),
  ('a3333333-0000-0000-0000-000000000002', 'Jeans',            'bottoms-jeans',    'a3333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=500', 2),
  ('a3333333-0000-0000-0000-000000000003', 'Leggings',         'bottoms-leggings', 'a3333333-3333-3333-3333-333333333333', NULL, 3),
  ('a3333333-0000-0000-0000-000000000004', 'Shorts',           'bottoms-shorts',   'a3333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=500', 4),
  ('a3333333-0000-0000-0000-000000000005', 'Skirts',           'bottoms-skirts',   'a3333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1583496661160-fb488653d5d1?w=500', 5)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Dresses & Jumpsuits ───────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a4444444-0000-0000-0000-000000000001', 'Casual dresses',    'dresses-casual',        'a4444444-4444-4444-4444-444444444444', NULL, 1),
  ('a4444444-0000-0000-0000-000000000002', 'Formal dresses',    'dresses-formal',        'a4444444-4444-4444-4444-444444444444', NULL, 2),
  ('a4444444-0000-0000-0000-000000000003', 'Maxi / midi / mini','dresses-maxi-midi-mini','a4444444-4444-4444-4444-444444444444', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500', 3),
  ('a4444444-0000-0000-0000-000000000004', 'Jumpsuits / rompers','dresses-jumpsuits-sub','a4444444-4444-4444-4444-444444444444', 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=500', 4)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Footwear ──────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a5555555-0000-0000-0000-000000000001', 'Sneakers', 'footwear-sneakers', 'a5555555-5555-5555-5555-555555555555', NULL, 1),
  ('a5555555-0000-0000-0000-000000000002', 'Sandals',  'footwear-sandals',  'a5555555-5555-5555-5555-555555555555', NULL, 2),
  ('a5555555-0000-0000-0000-000000000003', 'Heels',    'footwear-heels',    'a5555555-5555-5555-5555-555555555555', NULL, 3),
  ('a5555555-0000-0000-0000-000000000004', 'Flats',    'footwear-flats',    'a5555555-5555-5555-5555-555555555555', NULL, 4),
  ('a5555555-0000-0000-0000-000000000005', 'Boots',    'footwear-boots',    'a5555555-5555-5555-5555-555555555555', NULL, 5)
ON CONFLICT (id) DO NOTHING;

-- ── 6. Knitwear / Layering ───────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a6666666-0000-0000-0000-000000000001', 'Sweaters',             'knitwear-sweaters',   'a6666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=500', 1),
  ('a6666666-0000-0000-0000-000000000002', 'Cardigans',            'knitwear-cardigans',  'a6666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=500', 2),
  ('a6666666-0000-0000-0000-000000000003', 'Pullovers',            'knitwear-pullovers',  'a6666666-6666-6666-6666-666666666666', NULL, 3),
  ('a6666666-0000-0000-0000-000000000004', 'Hoodies / sweatshirts','knitwear-hoodies',    'a6666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=500', 4)
ON CONFLICT (id) DO NOTHING;

-- ── 7. Loungewear & Sleepwear ────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a7777777-0000-0000-0000-000000000001', 'Pajamas',    'loungewear-pajamas',    'a7777777-7777-7777-7777-777777777777', 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=500', 1),
  ('a7777777-0000-0000-0000-000000000002', 'Lounge sets','loungewear-sets',       'a7777777-7777-7777-7777-777777777777', 'https://images.unsplash.com/photo-1508609312543-70e1766f153f?w=500', 2),
  ('a7777777-0000-0000-0000-000000000003', 'Robes',      'loungewear-robes',      'a7777777-7777-7777-7777-777777777777', NULL, 3)
ON CONFLICT (id) DO NOTHING;

-- ── 8. Outerwear ─────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a8888888-0000-0000-0000-000000000001', 'Jackets',        'outerwear-jackets', 'a8888888-8888-8888-8888-888888888888', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500', 1),
  ('a8888888-0000-0000-0000-000000000002', 'Coats',          'outerwear-coats',   'a8888888-8888-8888-8888-888888888888', 'https://images.unsplash.com/photo-1525450824786-227cbef70703?w=500', 2),
  ('a8888888-0000-0000-0000-000000000003', 'Blazers',        'outerwear-blazers','a8888888-8888-8888-8888-888888888888', NULL, 3),
  ('a8888888-0000-0000-0000-000000000004', 'Parkas / puffers','outerwear-parkas','a8888888-8888-8888-8888-888888888888', NULL, 4)
ON CONFLICT (id) DO NOTHING;

-- ── 9. Tops ──────────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('a9999999-0000-0000-0000-000000000001', 'T-Shirts',           'tops-t-shirts',       'a9999999-9999-9999-9999-999999999999', 'https://images.unsplash.com/photo-1554568218-0f1715e72254?w=500', 1),
  ('a9999999-0000-0000-0000-000000000002', 'Tank tops / camis',  'tops-tanks-camis',    'a9999999-9999-9999-9999-999999999999', NULL, 2),
  ('a9999999-0000-0000-0000-000000000003', 'Blouses',            'tops-blouses',        'a9999999-9999-9999-9999-999999999999', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500', 3),
  ('a9999999-0000-0000-0000-000000000004', 'Shirts (button-down)','tops-button-down',   'a9999999-9999-9999-9999-999999999999', NULL, 4),
  ('a9999999-0000-0000-0000-000000000005', 'Crop tops',          'tops-crop',           'a9999999-9999-9999-9999-999999999999', NULL, 5)
ON CONFLICT (id) DO NOTHING;

-- ── 10. Underwear / Intimates ────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Bras',         'underwear-bras',      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 1),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Panties',      'underwear-panties',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'https://images.unsplash.com/photo-1573612244737-144d183f3e1a?w=500', 2),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Shapewear',    'underwear-shapewear', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 3),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Thermal wear', 'underwear-thermal',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 4)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- DELETE FROM public.categories WHERE id::text LIKE 'a%' AND id::text ~ '^a';
-- (safer/explicit: DELETE FROM categories WHERE id IN (<all ids above>))
-- ═════════════════════════════════════════════════════════════════════════
