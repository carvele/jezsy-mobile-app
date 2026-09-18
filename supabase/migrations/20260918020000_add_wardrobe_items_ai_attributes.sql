-- Migration: 20260918020000_add_wardrobe_items_ai_attributes.sql
-- Description: Add ai_attributes, occasions, and seasons columns to wardrobe_items table

ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS ai_attributes jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS occasions text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seasons text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_wardrobe_items_occasions ON public.wardrobe_items USING gin(occasions);
