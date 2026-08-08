-- Restricts review submission and verified_purchase computation to completed or active (collected) reservations.
-- Follows standard Amazon / Shopify verified purchaser model.

CREATE OR REPLACE FUNCTION public.set_review_verified_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.verified_purchase := EXISTS (
    SELECT 1
    FROM public.reservation_items ri
    JOIN public.reservations r ON r.id = ri.reservation_id
    WHERE r.customer_id = NEW.user_id
      AND ri.product_id = NEW.product_id
      AND coalesce(r.deleted, false) = false
      AND r.status IN ('Completed', 'Active')
  );
  RETURN NEW;
END;
$$;

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
          AND r.status IN ('Completed', 'Active')
      )
    )
  );
