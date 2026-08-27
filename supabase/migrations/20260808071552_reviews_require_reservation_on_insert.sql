-- Reviews had no purchase/reservation gate at all: the only INSERT check was
-- "Enable all access for own reviews or owner" WITH CHECK (user_id =
-- auth.uid() OR is_staff_or_admin()), which lets any signed-in customer
-- review any product regardless of whether they ever reserved it.
-- verified_purchase (see 20260729024656 / 20260808120000) only ever computed
-- a display badge after the fact -- it never blocked the insert.
--
-- Splitting the single FOR ALL policy into per-command policies rather than
-- ANDing a reservation check into its existing WITH CHECK: that WITH CHECK
-- also governs UPDATE, and a customer editing their own review shouldn't
-- lose the ability to if their reservation is later cancelled/soft-deleted.
-- Only INSERT should require an active reservation; SELECT/UPDATE/DELETE stay
-- ownership-based, same as before.

DROP POLICY IF EXISTS "Enable all access for own reviews or owner" ON public.reviews;
DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;

CREATE POLICY "Customers can insert reviews for reserved products"
  ON public.reviews FOR INSERT
  WITH CHECK (
    is_staff_or_admin()
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.reservation_items ri
        JOIN public.reservations r ON r.id = ri.reservation_id
        WHERE r.customer_id = auth.uid()
          AND ri.product_id = reviews.product_id
          AND coalesce(r.deleted, false) = false
      )
    )
  );

DROP POLICY IF EXISTS "Customers can update own reviews" ON public.reviews;
CREATE POLICY "Customers can update own reviews"
  ON public.reviews FOR UPDATE
  USING (user_id = auth.uid() OR is_staff_or_admin())
  WITH CHECK (user_id = auth.uid() OR is_staff_or_admin());

DROP POLICY IF EXISTS "Customers can delete own reviews" ON public.reviews;
CREATE POLICY "Customers can delete own reviews"
  ON public.reviews FOR DELETE
  USING (user_id = auth.uid() OR is_staff_or_admin());

-- "Anyone can view reviews" (SELECT, USING true) is untouched.
