-- Rollback recreates the duplicate unique indexes dropped above.
CREATE UNIQUE INDEX IF NOT EXISTS orders_display_id_uidx ON public.orders (display_id);
CREATE UNIQUE INDEX IF NOT EXISTS wishlists_user_product_uidx ON public.wishlists (user_id, product_id);
