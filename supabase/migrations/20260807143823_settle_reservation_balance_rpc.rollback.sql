-- Rollback: drop the settlement RPC. The columns survive; only the guarded
-- write path goes.
DROP FUNCTION IF EXISTS public.settle_reservation_balance(uuid, text);
