-- Historical ledger recovery: this is the exact policy body recorded under
-- remote version 20260910260000 after a legacy .rollback.sql file was treated
-- as a forward migration. A later migration restores the intended rule.
DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;
CREATE POLICY "Customers can insert reviews for reserved products"
  ON public.reviews FOR INSERT
  WITH CHECK (
    is_staff_or_admin()
    OR (
      user_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.reservation_items ri
        JOIN public.reservations r ON r.id = ri.reservation_id
        WHERE r.customer_id = (SELECT auth.uid())
          AND ri.product_id = reviews.product_id
          AND coalesce(r.deleted, false) = false
      )
    )
  );
