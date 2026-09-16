-- Migration: 20260916010000_wardrobe_ai_stylist_upgrade.sql
-- Description: Backward-compatible schema extensions for AI wardrobe and personal stylist features

-- 1. Add additive columns to wardrobe_items
ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS pattern text,
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS fit text,
  ADD COLUMN IF NOT EXISTS length_type text,
  ADD COLUMN IF NOT EXISTS sleeve_type text,
  ADD COLUMN IF NOT EXISTS neckline text,
  ADD COLUMN IF NOT EXISTS silhouette text,
  ADD COLUMN IF NOT EXISTS occasions text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seasons text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS color_details jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_custom_category boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_attributes jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_confidence real DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS user_corrections jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS embedding jsonb DEFAULT NULL;

-- 2. Add wardrobe_item_id to outfit_items if not present
ALTER TABLE public.outfit_items
  ADD COLUMN IF NOT EXISTS wardrobe_item_id uuid REFERENCES public.wardrobe_items(id) ON DELETE SET NULL;

-- 3. Create user_style_profiles table
CREATE TABLE IF NOT EXISTS public.user_style_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferred_garment_types text[] NOT NULL DEFAULT '{}'::text[],
  preferred_fits text[] NOT NULL DEFAULT '{}'::text[],
  preferred_occasions text[] NOT NULL DEFAULT '{}'::text[],
  avoided_patterns text[] NOT NULL DEFAULT '{}'::text[],
  avoided_colors text[] NOT NULL DEFAULT '{}'::text[],
  preferred_colors text[] NOT NULL DEFAULT '{}'::text[],
  style_keywords text[] NOT NULL DEFAULT '{}'::text[],
  explicit_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  preference_weights jsonb NOT NULL DEFAULT '{"colorHarmony": 0.40, "composition": 0.35, "personalStyle": 0.25}'::jsonb,
  feedback_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on user_style_profiles
ALTER TABLE public.user_style_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_style_profiles' AND policyname = 'user_style_profiles_owner_select'
  ) THEN
    CREATE POLICY user_style_profiles_owner_select ON public.user_style_profiles
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_style_profiles' AND policyname = 'user_style_profiles_owner_insert'
  ) THEN
    CREATE POLICY user_style_profiles_owner_insert ON public.user_style_profiles
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_style_profiles' AND policyname = 'user_style_profiles_owner_update'
  ) THEN
    CREATE POLICY user_style_profiles_owner_update ON public.user_style_profiles
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Create outfit_feedback table
CREATE TABLE IF NOT EXISTS public.outfit_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  outfit_id uuid REFERENCES public.saved_outfits(id) ON DELETE SET NULL,
  feedback_type text NOT NULL, -- 'saved', 'rejected', 'liked', 'disliked', 'worn', 'rated'
  rating smallint CHECK (rating >= 1 AND rating <= 5),
  occasion text,
  wardrobe_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on outfit_feedback
ALTER TABLE public.outfit_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'outfit_feedback' AND policyname = 'outfit_feedback_owner_select'
  ) THEN
    CREATE POLICY outfit_feedback_owner_select ON public.outfit_feedback
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'outfit_feedback' AND policyname = 'outfit_feedback_owner_insert'
  ) THEN
    CREATE POLICY outfit_feedback_owner_insert ON public.outfit_feedback
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_wardrobe_items_user_occasions ON public.wardrobe_items USING gin(occasions);
CREATE INDEX IF NOT EXISTS idx_outfit_feedback_user_id ON public.outfit_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_outfit_feedback_created_at ON public.outfit_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outfit_items_wardrobe_item_id ON public.outfit_items(wardrobe_item_id);
