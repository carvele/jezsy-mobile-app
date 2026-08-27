-- Finding N-7, residual of H-1. create_reservations_from_cart() is an
-- unauthenticated, RLS-bypassing, client-price-trusting RPC. EXECUTE was
-- already revoked from anon and authenticated, so it is unreachable from the
-- mobile app, and DB_IMPLEMENTATION_PLAN.md lists it as a dead object.
--
-- BLAST RADIUS: service_role retains EXECUTE regardless of the revokes, so a
-- server-side caller in the owner-dashboard repo could still be using this.
-- Confirm with the owner-dashboard owner before applying.

DROP FUNCTION IF EXISTS public.create_reservations_from_cart(jsonb);
