-- Staff/owner could not view any customer's uploaded payment receipt.
-- The only SELECT policy on the payment_receipts bucket restricts read to
-- the uploading customer ((storage.foldername(name))[1] = auth.uid()::text),
-- with no staff bypass at all -- "Verify Payment" in owner has been
-- non-functional since the bucket was created, since the receipt image
-- could never load for anyone but the customer who uploaded it.
--
-- is_staff_or_admin() already exists (SECURITY DEFINER, checks
-- profiles.role IN ('staff', 'owner')) and gates the rest of the
-- staff-facing RLS surface, so this reuses it rather than re-deriving role
-- logic here.

DROP POLICY IF EXISTS "Staff can read payment receipts" ON storage.objects;

CREATE POLICY "Staff can read payment receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment_receipts'
  AND public.is_staff_or_admin()
);
