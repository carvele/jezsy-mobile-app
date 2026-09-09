-- Style Inspiration (home screen) was rendering 4 real pose_guides rows that
-- were actually AR calibration/reference poses (names "Front T-Pose", "Side
-- Profile"; categories "Calibration", "Preview", "Dynamic", "Turn"), all with
-- occasion = NULL and no linked products. Consequence: every card showed a
-- blank camera-icon placeholder, 6 of the 7 occasion filter chips always
-- returned zero results, and "Try Look" led to a product-less page.
--
-- Repurposes these same 4 rows (base_pose_type is untouched -- it's the
-- mechanical field poseMatcher-style AR code keys off, not the display
-- name/category) into real curated looks: a display name/category that
-- reads as style content, a real occasion tag matching the filter chips,
-- a short description, and 2 linked products each via pose_guide_products.
-- image_url is an existing product photo as a stand-in for real pose
-- photography, which doesn't exist yet.

UPDATE public.pose_guides SET
  name = 'Boardroom Sharp',
  category = 'Boardroom',
  occasion = 'Formal',
  description = 'Sharp tailoring for the office or an important meeting.',
  image_url = 'https://res.cloudinary.com/dlrlgp4bq/image/upload/v1786581396/jqsav8qger1smn3ll9yf.webp',
  is_featured = true
WHERE id = 'P-001';

UPDATE public.pose_guides SET
  name = 'Silk Evening',
  category = 'Romantic',
  occasion = 'Date Night',
  description = 'Effortlessly elegant for a night out.',
  image_url = 'https://res.cloudinary.com/dlrlgp4bq/image/upload/v1787617398/qpwlhmoihx25gz4i44ge.webp',
  is_featured = true
WHERE id = 'P-002';

UPDATE public.pose_guides SET
  name = 'Off-Duty Ease',
  category = 'Off-Duty',
  occasion = 'Casual',
  description = 'Easy, everyday pieces for running errands or a casual hang.',
  image_url = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800',
  is_featured = true
WHERE id = 'P-003';

UPDATE public.pose_guides SET
  name = 'Bold Bomber Night',
  category = 'Statement',
  occasion = 'Party',
  description = 'A bold layer that turns heads at any party.',
  image_url = 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800',
  is_featured = true
WHERE id = 'P-004';

INSERT INTO public.pose_guide_products (pose_guide_id, product_id, sort_order) VALUES
  ('P-001', 'b0000008-0000-4000-8000-000000000002', 0), -- Tailored Blazer
  ('P-001', 'b0000003-0000-4000-8000-000000000001', 1), -- Straight-Leg Jeans
  ('P-002', 'b0000009-0000-4000-8000-000000000001', 0), -- Silk Blouse
  ('P-002', 'b0000003-0000-4000-8000-000000000002', 1), -- Pleated Midi Skirt
  ('P-003', 'b0000009-0000-4000-8000-000000000002', 0), -- Cotton T-Shirt
  ('P-003', 'b0000002-0000-4000-8000-000000000002', 1), -- High-Waist Leggings
  ('P-004', 'b0000008-0000-4000-8000-000000000001', 0), -- Bomber Jacket
  ('P-004', 'b0000005-0000-4000-8000-000000000002', 1)  -- Leather Ankle Boots
ON CONFLICT (pose_guide_id, product_id) DO NOTHING;
