-- Reverts 20260727080300_revoke_direct_rpc_on_trigger_functions.sql
--
-- Restores the PostgreSQL default of EXECUTE granted to PUBLIC.

GRANT EXECUTE ON FUNCTION public.notify_order_status_change() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_reservation_status_change() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sync_product_stock_from_inventory() TO PUBLIC;
