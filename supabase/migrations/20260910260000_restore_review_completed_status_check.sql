-- Restores the reservation-status check on the reviews INSERT policy.
-- 20260809003000_require_completed_reservation_for_reviews.sql originally
-- required r.status IN ('Completed', 'Active') alongside the reservation
-- ownership check -- but 20260813075946_fix_rls_auth_uid_initplan_performance.sql,
-- a mechanical rewrite of many policies to wrap auth.uid() for planner
-- performance, silently dropped that status condition while rewriting this
-- one. Confirmed by diffing the two migrations' WITH CHECK clauses.
--
-- Net effect of the regression: the reviews table would accept a review for
-- a reservation that was merely 'Pending' or 'To Pay' -- never even started,
-- let alone completed -- as long as a reservation_items row existed for that
-- product. The mobile client's own eligibility check (ReviewsList.tsx) never
-- had this gap; it always required status IN ('Completed', 'Active') before
-- showing the "Write a Review" button. This migration makes the database
-- match what the client already assumed, restoring it as the authoritative
-- gate.
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
          AND r.status IN ('Completed', 'Active')
      )
    )
  );
