-- Migration: Add canvas_layout to saved_outfits and bbox to wardrobe_items
-- Supports My Mannequin paper-doll canvas styling layout.

ALTER TABLE public.saved_outfits
  ADD COLUMN IF NOT EXISTS canvas_layout jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.saved_outfits.canvas_layout IS
  'Spatial arrangement of items on the styling canvas: array of { wardrobe_item_id, x, y, scale, rotation, z_index }.';

ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS bbox jsonb DEFAULT NULL;

COMMENT ON COLUMN public.wardrobe_items.bbox IS
  'Visible-subject bounding box within the cutout PNG { x, y, width, height } computed at upload time.';
