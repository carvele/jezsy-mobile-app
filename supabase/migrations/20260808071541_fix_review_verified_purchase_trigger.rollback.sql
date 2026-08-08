-- Rollback restores the pre-fix function body verbatim. Applying this
-- rollback re-breaks review submission -- public.orders/public.order_items
-- were dropped in 20260730142705_drop_orders and remain dropped, so this
-- EXISTS branch will fail at runtime on every review INSERT, exactly as it
-- did before this migration. Kept for symmetry with the migration/rollback
-- convention, not because reverting is ever the right move here.

CREATE OR REPLACE FUNCTION public.set_review_verified_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.verified_purchase := EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.customer_id = NEW.user_id
      AND oi.product_id = NEW.product_id
  ) OR EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.customer_id = NEW.user_id
      AND r.product_id = NEW.product_id
      AND coalesce(r.deleted, false) = false
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM PUBLIC, anon, authenticated;
