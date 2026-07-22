-- Rollback for 20260720140000_close_price_manipulation_vector.sql

DROP POLICY IF EXISTS "Enable insert for admin only" ON public.reservations;
DROP POLICY IF EXISTS "Enable update for admin only" ON public.reservations;

CREATE POLICY "Enable insert for own reservations or admin"
  ON public.reservations FOR INSERT
  WITH CHECK ((customer_id = auth.uid()) OR is_admin_or_owner());

CREATE POLICY "Enable update for own reservations or admin"
  ON public.reservations FOR UPDATE
  USING ((customer_id = auth.uid()) OR is_admin_or_owner())
  WITH CHECK ((customer_id = auth.uid()) OR is_admin_or_owner());

CREATE POLICY "Users can insert their own reservations"
  ON public.reservations FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "Users can view their own reservations"
  ON public.reservations FOR SELECT
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Enable select for own orders or staff" ON public.orders;
DROP POLICY IF EXISTS "Enable write for staff only" ON public.orders;

CREATE POLICY "Users can manage their own orders"
  ON public.orders FOR ALL
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Enable select for own order items or staff" ON public.order_items;
DROP POLICY IF EXISTS "Enable write for staff only" ON public.order_items;

CREATE POLICY "Users can manage their own order items"
  ON public.order_items FOR ALL
  USING (
    order_id IN (SELECT id FROM public.orders WHERE customer_id = auth.uid())
  );

ALTER FUNCTION public.create_order(jsonb, jsonb) SECURITY INVOKER;
ALTER FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) SECURITY INVOKER;
