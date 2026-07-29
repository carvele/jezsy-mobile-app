-- Follow-up to 20260729014307_review_images_bucket: same
-- public_bucket_allows_listing finding fixed for ar-models/avatars/
-- chat-images/wardrobe-images in 20260720260000_storage_no_listing.sql.
-- review-images is a public bucket served via getPublicUrl(), which
-- bypasses RLS entirely -- the broad SELECT policy this migration drops
-- was never needed for reads, only for storage.list()/.download(), neither
-- of which this app calls.

DROP POLICY IF EXISTS "Public read access to review-images" ON storage.objects;
