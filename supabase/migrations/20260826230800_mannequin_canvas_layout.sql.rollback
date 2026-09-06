-- Rollback: Remove canvas_layout from saved_outfits and bbox from wardrobe_items

ALTER TABLE public.saved_outfits
  DROP COLUMN IF EXISTS canvas_layout;

ALTER TABLE public.wardrobe_items
  DROP COLUMN IF EXISTS bbox;
