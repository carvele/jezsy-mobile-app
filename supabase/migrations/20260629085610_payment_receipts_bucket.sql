-- Migration: Add payment_receipts storage bucket

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment_receipts', 'payment_receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Public can view payment receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own payment receipts" ON storage.objects;

CREATE POLICY "Users can upload their own payment receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'payment_receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read their own payment receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'payment_receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
