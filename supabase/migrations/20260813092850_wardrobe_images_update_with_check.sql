-- The wardrobe-images storage UPDATE policy checks folder ownership on the
-- OLD row (USING) but never re-checks the NEW row (no WITH CHECK), so a user
-- could rename/move their own object into another user's folder path -- the
-- exact class of gap RLS UPDATE policies need both clauses to close.
-- Introduced in 20260715000001_wardrobe_setup.sql, never fixed since.

DROP POLICY IF EXISTS "Auth update own wardrobe-images" ON storage.objects;
CREATE POLICY "Auth update own wardrobe-images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'wardrobe-images' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'wardrobe-images' AND (storage.foldername(name))[1] = auth.uid()::text);
