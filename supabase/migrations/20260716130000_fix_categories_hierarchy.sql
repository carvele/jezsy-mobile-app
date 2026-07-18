BEGIN;

DELETE FROM public.categories WHERE parent_id IS NOT NULL;
DELETE FROM public.categories;

-- Tops
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tops',               'tops',               NULL, 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600', 1),
  ('22222222-2222-2222-2222-222222222222', 'Bottoms',            'bottoms',            NULL, 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600', 2),
  ('33333333-3333-3333-3333-333333333333', 'Outerwear',          'outerwear',          NULL, 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600', 3),
  ('44444444-4444-4444-4444-444444444444', 'Dresses',            'dresses',            NULL, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600', 4),
  ('55555555-5555-5555-5555-555555555555', 'Innerwear & Lounge', 'innerwear-lounge',   NULL, 'https://images.unsplash.com/photo-1508609312543-70e1766f153f?w=600', 5),
  ('66666666-6666-6666-6666-666666666666', 'Accessories',        'accessories',        NULL, 'https://images.unsplash.com/photo-1576053139778-7e32f2ae3cf4?w=600', 6);

-- Tops subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('11111111-1111-1111-1111-000000000001', 'T-Shirts',          't-shirts',           '11111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1554568218-0f1715e72254?w=500', 1),
  ('11111111-1111-1111-1111-000000000002', 'Blouses',           'blouses',            '11111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500', 2),
  ('11111111-1111-1111-1111-000000000003', 'Knits & Sweaters',  'knits-sweaters',     '11111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=500', 3),
  ('11111111-1111-1111-1111-000000000004', 'Hoodies',           'hoodies',            '11111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=500', 4);

-- Bottoms subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('22222222-2222-2222-2222-000000000001', 'Jeans',   'jeans',   '22222222-2222-2222-2222-222222222222', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=500', 1),
  ('22222222-2222-2222-2222-000000000002', 'Pants',   'pants',   '22222222-2222-2222-2222-222222222222', 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=500', 2),
  ('22222222-2222-2222-2222-000000000003', 'Skirts',  'skirts',  '22222222-2222-2222-2222-222222222222', 'https://images.unsplash.com/photo-1583496661160-fb488653d5d1?w=500', 3),
  ('22222222-2222-2222-2222-000000000004', 'Shorts',  'shorts',  '22222222-2222-2222-2222-222222222222', 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=500', 4);

-- Outerwear subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('33333333-3333-3333-3333-000000000001', 'Jackets',   'jackets',   '33333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500', 1),
  ('33333333-3333-3333-3333-000000000002', 'Coats',     'coats',     '33333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1525450824786-227cbef70703?w=500', 2),
  ('33333333-3333-3333-3333-000000000003', 'Cardigans', 'cardigans', '33333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=500', 3);

-- Dresses subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('44444444-4444-4444-4444-000000000001', 'Dresses',    'dresses-sub',   '44444444-4444-4444-4444-444444444444', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500', 1),
  ('44444444-4444-4444-4444-000000000002', 'Jumpsuits',  'jumpsuits',     '44444444-4444-4444-4444-444444444444', 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=500', 2);

-- Innerwear & Lounge subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('55555555-5555-5555-5555-000000000001', 'Socks',      'socks',      '55555555-5555-5555-5555-555555555555', 'https://images.unsplash.com/photo-1582966772680-860e372bb558?w=500', 1),
  ('55555555-5555-5555-5555-000000000002', 'Underwear',  'underwear',  '55555555-5555-5555-5555-555555555555', 'https://images.unsplash.com/photo-1573612244737-144d183f3e1a?w=500', 2),
  ('55555555-5555-5555-5555-000000000003', 'Loungewear', 'loungewear', '55555555-5555-5555-5555-555555555555', 'https://images.unsplash.com/photo-1508609312543-70e1766f153f?w=500', 3),
  ('55555555-5555-5555-5555-000000000004', 'Pajamas',    'pajamas',    '55555555-5555-5555-5555-555555555555', 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=500', 4);

-- Accessories subcategories
INSERT INTO public.categories (id, name, slug, parent_id, image_url, sort_order) VALUES
  ('66666666-6666-6666-6666-000000000001', 'Bags',    'bags',    '66666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500', 1),
  ('66666666-6666-6666-6666-000000000002', 'Belts',   'belts',   '66666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1624222247344-550fb80f02d6?w=500', 2),
  ('66666666-6666-6666-6666-000000000003', 'Jewelry', 'jewelry', '66666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=500', 3),
  ('66666666-6666-6666-6666-000000000004', 'Hats',    'hats',    '66666666-6666-6666-6666-666666666666', 'https://images.unsplash.com/photo-1534215754734-18e55d13ce3a?w=500', 4);

COMMIT;
