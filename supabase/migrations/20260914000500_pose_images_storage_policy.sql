-- Migration: Add RLS policy for pose-images storage bucket
--
-- The pose-images bucket was created in 20260813150000_apply_pending_staff_role_pose_guides_inventory_cascade.sql,
-- but no storage.objects RLS policy was established. As storage.objects has RLS enabled,
-- staff/admin image uploads in the Admin Dashboard (StyleInspiration.jsx) fail with:
-- "StorageApiError: new row violates row-level security policy"
--
-- Public reads are handled via /storage/v1/object/public/pose-images/...
-- Management (upload, update, delete) requires staff/admin privileges via is_staff_or_admin().

DROP POLICY IF EXISTS "Admin/staff can manage pose images" ON storage.objects;

CREATE POLICY "Admin/staff can manage pose images"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'pose-images' AND public.is_staff_or_admin())
  WITH CHECK (bucket_id = 'pose-images' AND public.is_staff_or_admin());
