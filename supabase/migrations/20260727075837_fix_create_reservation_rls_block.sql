-- Customers cannot create reservations at all.
--
-- create_reservation() is SECURITY INVOKER, so its INSERT runs with the
-- caller's privileges and is evaluated against the reservations INSERT
-- policy: WITH CHECK (is_admin_or_owner()). A customer passes every one of
-- the function's internal guards and is then refused by RLS at the INSERT.
-- This is why the table has no customer rows.
--
-- create_order() has the identical shape (auth-gated, server-side price
-- resolution, caller-derived owner id) and is already SECURITY DEFINER.
-- Align create_reservation with it rather than opening a direct-INSERT
-- policy on reservations, which would re-expose the client-supplied price
-- vector closed by 20260720140000_close_price_manipulation_vector.sql.
--
-- Safe to run elevated: customer_id is taken from auth.uid() and never from
-- a parameter, rental_price/deposit are recomputed from products, the
-- receipt path is checked to belong to the caller, and status/payment_status/
-- payment_type are hardcoded. search_path is already pinned on the function.

-- Grants are handled separately in
-- 20260727075852_revoke_create_reservation_public_execute.sql.

ALTER FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text)
  SECURITY DEFINER;
