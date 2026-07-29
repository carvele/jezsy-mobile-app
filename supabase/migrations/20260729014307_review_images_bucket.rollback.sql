DROP POLICY IF EXISTS "Auth delete own review-images" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload to own review-images folder" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to review-images" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'review-images';
