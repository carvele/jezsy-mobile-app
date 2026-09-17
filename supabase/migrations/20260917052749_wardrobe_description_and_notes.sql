-- Migration: 20260917100000_wardrobe_description_and_notes.sql
-- Description: Additive migration adding description and user_notes to wardrobe_items table

ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS user_notes text;
