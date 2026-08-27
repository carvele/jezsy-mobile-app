-- Rollback restores the original single FOR ALL policy, removing the
-- reservation requirement on INSERT. Any authenticated user could once again
-- review any product regardless of purchase/reservation history.

DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;
DROP POLICY IF EXISTS "Customers can update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Customers can delete own reviews" ON public.reviews;

CREATE POLICY "Enable all access for own reviews or owner"
  ON public.reviews FOR ALL
  USING (user_id = auth.uid() OR is_staff_or_admin())
  WITH CHECK (user_id = auth.uid() OR is_staff_or_admin());
