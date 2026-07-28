-- Reverts 20260727080500_tighten_admin_update_using_predicates.sql
-- Restores USING (true) on all four policies.

ALTER POLICY "Allow admins to update categories" ON public.categories USING (true);
ALTER POLICY "Allow admins to update colors" ON public.color_list USING (true);
ALTER POLICY "Allow admins to update patterns" ON public.pattern_list USING (true);
ALTER POLICY "Allow admins to edit inventory columns on products" ON public.products USING (true);
