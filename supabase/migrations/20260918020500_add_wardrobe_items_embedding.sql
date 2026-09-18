-- Migration: 20260918020500_add_wardrobe_items_embedding.sql
-- Description: Add embedding column to wardrobe_items table

ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS embedding jsonb DEFAULT NULL;
