CREATE POLICY "Public read access to review-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'review-images');
