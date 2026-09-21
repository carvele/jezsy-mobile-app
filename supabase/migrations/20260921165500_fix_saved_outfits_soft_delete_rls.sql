-- Migration: 20260921165500_fix_saved_outfits_soft_delete_rls.sql
-- Description: Allow users to soft-delete saved outfits by decoupling owner SELECT RLS from deleted=false filter.

BEGIN;

-- 1. Redefine "Saved outfits read" SELECT policy
DROP POLICY IF EXISTS "Saved outfits read" ON public.saved_outfits;

CREATE POLICY "Saved outfits read"
ON public.saved_outfits
FOR SELECT
TO authenticated
USING (
  (user_id = (SELECT auth.uid()))
  OR is_staff_or_admin()
  OR (
    COALESCE(deleted, false) = false
    AND get_outfit_privacy(user_id) = 'public'
    AND NOT is_blocked_between((SELECT auth.uid()), user_id)
  )
);

COMMIT;
