-- Restore the intended verified-purchase boundary after the historical remote
-- rollback entry broadened review creation to any prior reservation.
DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;
CREATE POLICY "Customers can insert reviews for reserved products"
  ON public.reviews FOR INSERT TO authenticated
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
          AND r.status IN ('Completed', 'Active')
      )
    )
  );
