-- ============================================================================
-- REMAP ALL PRODUCTS TO THE NEW TAXONOMY
-- ============================================================================
-- Context: the new taxonomy (20260720190000) is more granular than the old
-- one in several places, so this is NOT a blind old-category-id ->
-- new-category-id bulk copy. Each product is assigned by what it actually
-- is, using its name:
--   * old "Knits & Sweaters" splits into new Sweaters vs Cardigans
--     ("Fine Knit Cardigan" is a cardigan, not a generic sweater)
--   * old generic "T-Shirts"/"Blouses" now has siblings "Crop tops" and
--     "Shirts (button-down)" ("Boxy Crop Tee" -> Crop tops, "Linen
--     Button-Up Shirt" -> Shirts (button-down))
--   * "Dresses" splits into Casual/Formal/Maxi-midi-mini
--
-- Includes ALL 21 products regardless of `deleted` status (19 are currently
-- archived) so nothing comes back mis-categorized if they're ever restored.
--
-- Also corrects 2 known mis-filings rather than migrating the error:
--   * "White Dress" was filed under Tops > Blouses (it's a dress)
--   * "White Simple Tee" was filed under a since-abandoned "Ball Gowns"
--     category (it's a t-shirt) -- category_id was already NULL
-- ...and assigns the 1 other NULL/uncategorized product ("Brown Dress",
-- previously under an abandoned "Cocktail & Party" category) to Formal
-- dresses.
--
-- IDEMPOTENT: matches by product name; safe to re-run.
-- ============================================================================

BEGIN;

UPDATE public.products SET category_id = v.new_category_id
FROM (VALUES
  ('Boxy Crop Tee',               'a9999999-0000-0000-0000-000000000005'::uuid), -- Tops > Crop tops
  ('Premium Cotton Crewneck Tee', 'a9999999-0000-0000-0000-000000000001'::uuid), -- Tops > T-Shirts
  ('Linen Button-Up Shirt',       'a9999999-0000-0000-0000-000000000004'::uuid), -- Tops > Shirts (button-down)
  ('Silk V-Neck Blouse',          'a9999999-0000-0000-0000-000000000003'::uuid), -- Tops > Blouses
  ('Cashmere Mockneck Sweater',   'a6666666-0000-0000-0000-000000000001'::uuid), -- Knitwear/Layering > Sweaters
  ('Fine Knit Cardigan',          'a6666666-0000-0000-0000-000000000002'::uuid), -- Knitwear/Layering > Cardigans
  ('Oversized Fleece Hoodie',     'a6666666-0000-0000-0000-000000000004'::uuid), -- Knitwear/Layering > Hoodies/sweatshirts
  ('High-Rise Skinny Jeans',      'a3333333-0000-0000-0000-000000000002'::uuid), -- Bottoms > Jeans
  ('Wide-Leg Dad Jeans',          'a3333333-0000-0000-0000-000000000002'::uuid), -- Bottoms > Jeans
  ('Tailored Pleated Trousers',   'a3333333-0000-0000-0000-000000000001'::uuid), -- Bottoms > Pants / trousers
  ('Pleated Satin Skirt',         'a3333333-0000-0000-0000-000000000005'::uuid), -- Bottoms > Skirts
  ('Classic Denim Jacket',        'a8888888-0000-0000-0000-000000000001'::uuid), -- Outerwear > Jackets
  ('Vegan Leather Moto Jacket',   'a8888888-0000-0000-0000-000000000001'::uuid), -- Outerwear > Jackets
  ('Oversized Trench Coat',       'a8888888-0000-0000-0000-000000000002'::uuid), -- Outerwear > Coats
  ('Floral Summer Midi Dress',    'a4444444-0000-0000-0000-000000000003'::uuid), -- Dresses & Jumpsuits > Maxi/midi/mini
  ('Little Black Ribbed Dress',  'a4444444-0000-0000-0000-000000000001'::uuid), -- Dresses & Jumpsuits > Casual dresses
  ('Cozy Ribbed Knit Set',        'a7777777-0000-0000-0000-000000000002'::uuid), -- Loungewear & Sleepwear > Lounge sets
  ('Mini Leather Shoulder Bag',   'a1111111-0000-0000-0000-000000000001'::uuid), -- Accessories > Bags
  -- Corrections (mis-filed / uncategorized):
  ('White Dress',                 'a4444444-0000-0000-0000-000000000001'::uuid), -- was Tops>Blouses -> Dresses & Jumpsuits > Casual dresses
  ('White Simple Tee',            'a9999999-0000-0000-0000-000000000001'::uuid), -- was abandoned Ball Gowns -> Tops > T-Shirts
  ('Brown Dress',                 'a4444444-0000-0000-0000-000000000002'::uuid)  -- was abandoned Cocktail & Party -> Dresses & Jumpsuits > Formal dresses
) AS v(name, new_category_id)
WHERE products.name = v.name;

COMMIT;
