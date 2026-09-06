-- Reverts 20260730081131_revoke_anon_definer_execute.sql
--
-- Restores anon EXECUTE on four SECURITY DEFINER functions and re-opens
-- create_order to signed-in users. Note what that second part means: any
-- authenticated user regains the ability to create an order marked 'paid'
-- without paying. Only run this if you are reviving the buy-and-ship path, and
-- fix the hardcoded status first.

GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_staff_status(uuid, text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.sync_product_stock(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) TO authenticated;
