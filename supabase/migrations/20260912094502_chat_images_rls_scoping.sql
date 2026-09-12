-- Migration: Attachment Storage RLS & Domain Scoping (M2)
-- 1. Ensure chat-images bucket is private.
-- 2. Drop obsolete chat-images policies on storage.objects.
-- 3. Create SELECT policy scoped TO authenticated with defensive regex UUID validation,
--    checking conversations for support domain and direct_chat_participants for direct domain
--    (with strict zero staff bypass for direct chats), and a temporary read-only legacy bridge.
-- 4. Create INSERT policy scoped TO authenticated enforcing canonical support/... and direct/... paths.

UPDATE storage.buckets SET public = false WHERE id = 'chat-images';

DROP POLICY IF EXISTS "Public read access to chat-images" ON storage.objects;
DROP POLICY IF EXISTS "Participants can view chat images" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload to own chat-images folder" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own chat-images" ON storage.objects;
DROP POLICY IF EXISTS "Authorized participants can view chat images" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can upload chat images" ON storage.objects;

-- SELECT Policy
CREATE POLICY "Authorized participants can view chat images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-images' AND (
    -- Support domain: Customer or Staff
    (
      (storage.foldername(name))[1] = 'support'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = ((storage.foldername(name))[2])::uuid
          AND (c.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
      )
    )
    OR
    -- Direct domain: Participants ONLY (zero staff bypass)
    (
      (storage.foldername(name))[1] = 'direct'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.direct_chat_participants dcp
        WHERE dcp.chat_id = ((storage.foldername(name))[2])::uuid
          AND dcp.user_id = (SELECT auth.uid())
      )
    )
    OR
    -- Temporary Legacy Bridge (READ-ONLY, scheduled for removal after object backfill)
    (
      array_length(storage.foldername(name), 1) = 1
      AND EXISTS (
        SELECT 1 FROM public.messages m
        JOIN public.conversations c ON c.id = m.conversation_id
        WHERE (c.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
          AND (m.image_url = name OR right(m.image_url, length(name)) = name)
      )
    )
  )
);

-- INSERT Policy
CREATE POLICY "Authorized users can upload chat images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-images' AND (
    -- Support upload: caller is customer or staff of conversation
    (
      (storage.foldername(name))[1] = 'support'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = ((storage.foldername(name))[2])::uuid
          AND (c.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
      )
    )
    OR
    -- Direct upload: caller is participant
    (
      (storage.foldername(name))[1] = 'direct'
      AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.direct_chat_participants dcp
        WHERE dcp.chat_id = ((storage.foldername(name))[2])::uuid
          AND dcp.user_id = (SELECT auth.uid())
      )
    )
  )
);
