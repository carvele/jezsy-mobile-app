-- Migration: Stop public buckets from being listable
--
-- DB_AUDIT_2026-07-20.md finding 12 / Supabase advisor
-- public_bucket_allows_listing. Four public buckets (ar-models, avatars,
-- chat-images, wardrobe-images) each carry a broad
-- `USING (bucket_id = '<name>')` SELECT policy on storage.objects. On a
-- PUBLIC bucket that policy is not what serves the files -- it is what lets
-- any client call storage.list() and enumerate every object in the bucket.
--
-- This matters most for chat-images, which holds private conversation
-- photos: without this change, any client could enumerate every chat image
-- ever uploaded, across all conversations, and then fetch them by public URL.
--
-- WHY THIS IS SAFE (verified in both repos before writing):
--   * Public buckets serve objects via /storage/v1/object/public/... which
--     bypasses RLS entirely, so image rendering is unaffected.
--   * Both apps read exclusively through getPublicUrl() -- mobile
--     ([conversationId].tsx:142, wardrobe/add-item.tsx:198) and admin
--     (lib/storage.js:21, communicationService.js:48).
--   * Neither app calls storage .list() or .download(), the two operations
--     that actually require SELECT on storage.objects (grep-verified, no
--     hits in either repo).
--   * Uploads (.upload) need INSERT and deletes (.remove) need DELETE --
--     neither is touched here.
--
-- SCOPE NOTE: this removes enumeration, not public access. The objects
-- remain fetchable by anyone who has the URL. Making chat-images genuinely
-- private requires a private bucket plus signed URLs and a rewrite of how
-- messages render images -- explicitly out of scope in the original
-- chat_images_bucket migration and still out of scope here.
--
-- payment_receipts is deliberately untouched: its SELECT policy is already
-- correctly scoped to the owner's own folder.

DROP POLICY IF EXISTS "AR Models are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to chat-images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to wardrobe-images" ON storage.objects;
