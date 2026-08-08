-- Fixes set_review_verified_purchase(), broken by 20260730142705_drop_orders:
-- that migration dropped public.orders/public.order_items but never touched
-- this trigger function, which still queried them in its first EXISTS branch.
-- DROP TABLE does not fail on functions whose body references the table (plpgsql
-- bodies are opaque until executed), so the migration applied cleanly and the
-- break only surfaced at runtime -- every review INSERT since 2026-07-30 has
-- been throwing "relation \"public.order_items\" does not exist" from this
-- BEFORE INSERT trigger, i.e. the review-writing path has been fully down.
--
-- Also corrects a second, independent gap: 20260805230934_reservation_items
-- split multi-item reservations so only the *first* line stays denormalized
-- onto reservations.product_id (see create_reservation_multi) -- the other
-- lines only exist in reservation_items. The original reservations-only
-- branch here would have under-counted: a customer who reserved items #2/#3
-- of a multi-item reservation would never look verified for those products.
-- reservation_items carries every line (the first line included, redundantly
-- with reservations.product_id), so checking it alone is both correct and
-- sufficient -- no need to also check reservations.product_id.

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
  );
  RETURN NEW;
END;
$$;

-- Re-derive verified_purchase for every existing review under the corrected
-- (and now actually-runnable) logic, in both directions -- some reviews
-- backfilled true by the original migration's order_items branch may no
-- longer qualify, and some multi-item-reservation reviews that were never
-- reachable by the old logic now should.
UPDATE public.reviews rv
SET verified_purchase = EXISTS (
  SELECT 1
  FROM public.reservation_items ri
  JOIN public.reservations r ON r.id = ri.reservation_id
  WHERE r.customer_id = rv.user_id
    AND ri.product_id = rv.product_id
    AND coalesce(r.deleted, false) = false
)
WHERE rv.verified_purchase <> EXISTS (
  SELECT 1
  FROM public.reservation_items ri
  JOIN public.reservations r ON r.id = ri.reservation_id
  WHERE r.customer_id = rv.user_id
    AND ri.product_id = rv.product_id
    AND coalesce(r.deleted, false) = false
);

-- Same treatment as the other trigger functions in
-- 20260728015951_revoke_direct_rpc_on_trigger_functions.sql.
REVOKE EXECUTE ON FUNCTION public.set_review_verified_purchase() FROM PUBLIC, anon, authenticated;
