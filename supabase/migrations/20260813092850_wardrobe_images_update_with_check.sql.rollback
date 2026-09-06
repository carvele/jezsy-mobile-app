DROP POLICY IF EXISTS "Auth update own wardrobe-images" ON storage.objects;
CREATE POLICY "Auth update own wardrobe-images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'wardrobe-images' AND (storage.foldername(name))[1] = auth.uid()::text);
