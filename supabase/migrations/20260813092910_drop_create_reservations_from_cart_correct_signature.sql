-- 20260727080200_drop_create_reservations_from_cart.sql intended to drop
-- this dead, unauthenticated RLS-bypassing RPC, but used the wrong
-- signature (jsonb) instead of the real one (jsonb, text, text, text).
-- DROP FUNCTION IF EXISTS silently no-op'd, so the function has been living
-- on as SECURITY DEFINER dead code ever since -- unreachable by anon/
-- authenticated (EXECUTE was correctly revoked from both earlier), but
-- still EXECUTE-able by service_role and still present for anyone auditing
-- the schema to trip over.

DROP FUNCTION IF EXISTS public.create_reservations_from_cart(jsonb, text, text, text);
