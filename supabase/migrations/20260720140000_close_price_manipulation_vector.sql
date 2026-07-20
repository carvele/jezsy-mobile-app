-- Migration: Close the client-side price manipulation vector on orders and
-- reservations.
--
-- Concretely, the customer-writable paths being removed here are:
--   reservations  INSERT/UPDATE where customer_id = auth.uid()
--   orders        ALL commands where customer_id = auth.uid()
--   order_items   ALL commands where the parent order belongs to auth.uid()
--
-- Verified against both clients before writing this migration:
--   * Mobile app never UPDATEs or DELETEs reservations, orders, or
--     order_items. It reads them, and it creates them through the two RPCs.
--   * Admin dashboard's recordBoutiqueSale (src/services/productService.js)
--     inserts reservations with customer_id NULL via is_admin_or_owner(),
--     preserved below.
--   * Admin dashboard never touches orders or order_items directly.
--
-- The RPCs are flipped to SECURITY DEFINER so customers can still create
-- orders and reservations once direct table access is gone. Both reject a
-- NULL auth.uid(), set customer_id from auth.uid() rather than from input,
-- resolve price from public.products server-side, and pin search_path.

DROP POLICY IF EXISTS "Users can insert their own reservations" ON public.reservations;
DROP POLICY IF EXISTS "Users can view their own reservations" ON public.reservations;
DROP POLICY IF EXISTS "Enable insert for own reservations or admin" ON public.reservations;
DROP POLICY IF EXISTS "Enable update for own reservations or admin" ON public.reservations;

CREATE POLICY "Enable insert for admin only"
  ON public.reservations FOR INSERT
  WITH CHECK (is_admin_or_owner());

CREATE POLICY "Enable update for admin only"
  ON public.reservations FOR UPDATE
  USING (is_admin_or_owner())
  WITH CHECK (is_admin_or_owner());

DROP POLICY IF EXISTS "Users can manage their own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
DROP POLICY IF EXISTS "Enable all access for own orders or admin" ON public.orders;

CREATE POLICY "Enable select for own orders or staff"
  ON public.orders FOR SELECT
  USING (customer_id = auth.uid() OR is_staff_or_admin());

CREATE POLICY "Enable write for staff only"
  ON public.orders FOR ALL
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

DROP POLICY IF EXISTS "Users can manage their own order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can view their own order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can insert own order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can insert their own order items" ON public.order_items;
DROP POLICY IF EXISTS "Enable all access for own order items or admin" ON public.order_items;

CREATE POLICY "Enable select for own order items or staff"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.customer_id = auth.uid()
    )
    OR is_staff_or_admin()
  );

CREATE POLICY "Enable write for staff only"
  ON public.order_items FOR ALL
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

ALTER FUNCTION public.create_order(jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) SECURITY DEFINER;
