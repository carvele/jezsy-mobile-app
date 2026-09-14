-- Migration: fix_blouses_category
-- Corrects categorization of product b0000003-0000-4000-8000-000000000002 ('Blouses')
-- from T-Shirts to Blouses subcategory under Tops. Constrained to known-bad state for idempotency.

UPDATE public.products
SET
  sub_category = 'Blouses',
  category_id = 'a9999999-0000-0000-0000-000000000003'
WHERE id = 'b0000003-0000-4000-8000-000000000002'
  AND category = 'Tops'
  AND sub_category = 'T-Shirts';
