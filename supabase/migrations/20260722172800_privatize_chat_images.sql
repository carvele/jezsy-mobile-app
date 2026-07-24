-- The chat-images storage bucket was public, so private customer<->staff
-- chat photos were readable by anyone who obtained the object URL, with no
-- session required. Upload was already folder-scoped to the uploader
-- (auth.uid()); this migration removes the unauthenticated-read gap.
--
-- App-side: messages.image_url may now be either a legacy full public URL
-- (pre-existing rows) or a bare object path (new rows, going forward) --
-- see src/utils/chatImageUrl.ts, which resolves either form to a fresh
-- signed URL at render time. No data in existing rows is rewritten here.

UPDATE storage.buckets SET public = false WHERE id = 'chat-images';

CREATE POLICY "Participants can view chat images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-images'
  AND (
    is_staff_or_admin()
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE c.customer_id = auth.uid()
        AND right(m.image_url, length(name)) = name
    )
  )
);
