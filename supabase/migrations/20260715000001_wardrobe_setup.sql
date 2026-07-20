-- Migration: Add color_tags and wardrobe-images storage bucket

-- Add color_tags to wardrobe_items table
ALTER TABLE public.wardrobe_items 
ADD COLUMN IF NOT EXISTS color_tags text[] DEFAULT '{}'::text[];

-- Create storage bucket wardrobe-images
INSERT INTO storage.buckets (id, name, public)
VALUES ('wardrobe-images', 'wardrobe-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Public read access to wardrobe-images" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload to own wardrobe-images folder" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own wardrobe-images" ON storage.objects;
DROP POLICY IF EXISTS "Auth update own wardrobe-images" ON storage.objects;

-- Create RLS policies
CREATE POLICY "Public read access to wardrobe-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'wardrobe-images');

CREATE POLICY "Auth upload to own wardrobe-images folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Auth delete own wardrobe-images"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Auth update own wardrobe-images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
