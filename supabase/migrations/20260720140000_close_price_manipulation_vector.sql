-- Migration: Close the client-side price manipulation vector on orders and
-- reservations.
--
-- PROBLEM
-- create_order and create_reservation compute prices server-side, but both are
-- SECURITY INVOKER and the underlying tables still grant customers direct
-- write access. A tampered client simply skips the RPC and POSTs to
-- /rest/v1/reservations with rental_price: 0. Locking INSERT alone is not
-- enough -- the UPDATE policies let a customer rewrite the price of a row that
-- was created correctly, and order_items lets them set unit_price directly.
--
-- Concretely, the customer-writable paths being removed here are:
--   reservations  INSERT/UPDATE where customer_id = auth.uid()
--   orders        ALL commands where customer_id = auth.uid()
--   order_items   ALL commands where the parent order belongs to auth.uid()
--
-- WHY THIS IS SAFE
-- Verified against both clients before writing this migration:
--   * Mobile app (this repo) never UPDATEs or DELETEs reservations, orders, or
--     order_items. It reads them, and it creates them through the two RPCs.
--     Removing customer write access costs it nothing.
--   * Admin dashboard (github.com/carvele/admin-dashboard) does insert into
--     reservations -- recordBoutiqueSale in src/services/productService.js
--     records walk-in sales with customer_id NULL. That path authorises via
--     is_admin_or_owner(), which is preserved below, so it keeps working.
--   * Admin dashboard never touches orders or order_items at all (only renders
--     counts), so staff-only write policies there are forward-looking rather
--     than load-bearing.
--
-- The RPCs are flipped to SECURITY DEFINER so customers can still create
-- orders and reservations once direct table access is gone. Both are safe to
-- elevate: each rejects a NULL auth.uid(), sets customer_id from auth.uid()
-- rather than from input, resolves price from public.products server-side, and
-- already pins search_path.
--
-- NOTE (pre-existing, deliberately not changed here): is_admin_or_owner()
-- excludes the 'staff' role, so staff users already cannot record walk-in
-- sales or accept reservations. That is existing behaviour and reproducing it
-- exactly keeps this migration a pure security fix. Worth a separate look.

-- ── reservations ────────────────────────────────────────────────────────────
-- Customer keeps SELECT on their own rows; writes become admin-only.

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

-- ── orders ──────────────────────────────────────────────────────────────────
-- Both existing policies are FOR ALL and let the customer rewrite
-- total_amount. Split into read-for-owner, write-for-staff.

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

-- ── order_items ─────────────────────────────────────────────────────────────

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

-- ── elevate the RPCs ────────────────────────────────────────────────────────
-- Customers no longer have direct write access, so these must run as owner.

ALTER FUNCTION public.create_order(jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) SECURITY DEFINER;
