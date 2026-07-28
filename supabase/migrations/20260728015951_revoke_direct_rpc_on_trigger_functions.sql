-- Finding L-6. Trigger and utility SECURITY DEFINER functions are reachable
-- directly via /rest/v1/rpc/. They are low impact -- the notify_*/trg_* ones
-- error when called outside a trigger context -- but they are not meant to be
-- part of the public API and each one is elevated surface.
--
-- REVOKE FROM anon alone is a no-op: EXECUTE is granted to PUBLIC by default
-- and both anon and authenticated inherit it. Revoke PUBLIC explicitly.
-- Verify afterwards with has_function_privilege, not by reading the grant.
--
-- sync_product_stock is deliberately excluded: it recomputes derived stock and
-- the admin-dashboard repo may call it directly. Confirm before revoking that
-- one.

REVOKE EXECUTE ON FUNCTION public.notify_order_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_reservation_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_product_stock_from_inventory() FROM PUBLIC, anon, authenticated;
