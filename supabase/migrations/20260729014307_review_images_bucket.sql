-- Feature: review photos. reviews.images (text[]) already exists but
-- ReviewModal.tsx has always submitted an empty array -- "Image upload
-- omitted for brevity on free tier". Adds a dedicated public bucket,
-- folder-scoped to the uploader, matching the wardrobe-images/avatars/
-- ar-models/chat-images pattern already used in this project. Public read
-- is intentional here (unlike chat-images, which was privatized in
-- 20260722172800): reviews are public-facing content, same as product
-- photos.

INSERT INTO storage.buckets (id, name, public)
VALUES ('review-images', 'review-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read access to review-images" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload to own review-images folder" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own review-images" ON storage.objects;

CREATE POLICY "Public read access to review-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'review-images');

CREATE POLICY "Auth upload to own review-images folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'review-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Auth delete own review-images"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'review-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
