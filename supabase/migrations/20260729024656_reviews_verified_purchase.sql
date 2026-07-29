-- Feature: verified-purchase badge on reviews. ReviewsList.tsx has carried
-- unused verifiedBadge/verifiedText styles since it was written.
--
-- This must be a stored column, not a client-side join: orders and
-- reservations are RLS-scoped to their own customer, so a client can only
-- ever see its own purchase history and could never verify anyone else's
-- review. A SECURITY DEFINER trigger resolves it once at insert time and
-- stores the result on the review row, which every reader can already see.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS verified_purchase boolean NOT NULL DEFAULT false;

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

DROP TRIGGER IF EXISTS trg_set_review_verified_purchase ON public.reviews;
CREATE TRIGGER trg_set_review_verified_purchase
BEFORE INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.set_review_verified_purchase();

-- Backfill any reviews that predate the column.
UPDATE public.reviews rv
SET verified_purchase = true
WHERE rv.verified_purchase = false
  AND (
    EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.customer_id = rv.user_id AND oi.product_id = rv.product_id
    )
    OR EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.customer_id = rv.user_id
        AND r.product_id = rv.product_id
        AND coalesce(r.deleted, false) = false
    )
  );

-- Same treatment as the other trigger functions in
-- 20260728015951_revoke_direct_rpc_on_trigger_functions.sql.
REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM PUBLIC, anon, authenticated;
