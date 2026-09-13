-- ================================================================
-- Fix: Repair duplicate color entries in products.color for Mini Skirt
-- ================================================================

UPDATE public.products
SET
  color = 'Black, White, Sky Blue, Blue',
  base_color = 'Black',
  updated_at = now()
WHERE id = '4d5dacae-2ef0-4b82-a1d3-1d2b43530061'
  AND color = 'Black, Black, White, Sky Blue, Blue, Blue, Sky Blue, White';
