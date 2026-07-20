-- Migration: Revoke public/anon/authenticated execute on an unused,
-- price-trusting RPC discovered via security advisor scan.
--
-- public.create_reservations_from_cart(_items, _pickup_date, _pickup_time,
-- _display_id) is a SECURITY DEFINER function that inserts reservations
-- using unit_price/deposit values taken directly from the client-supplied
-- JSON payload (no server-side price computation, unlike create_order).
-- It is not called anywhere in the app client (verified via repo search),
-- but it was still executable by both `anon` and `authenticated` via
-- PostgREST (/rest/v1/rpc/create_reservations_from_cart), making it a live
-- price-manipulation vector independent of the mobile app.
--
-- Revoking execute removes the exposure with no behavior change, since no
-- client code calls it. If a cart-based multi-item reservation flow is
-- built in the future, this function should be rewritten to look up
-- product price/deposit server-side (mirroring create_order) before
-- being re-granted.

REVOKE EXECUTE ON FUNCTION public.create_reservations_from_cart(jsonb, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservations_from_cart(jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_reservations_from_cart(jsonb, text, text, text) FROM authenticated;
