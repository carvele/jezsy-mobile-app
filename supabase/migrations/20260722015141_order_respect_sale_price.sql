-- Fix: create_order charged full price even when a product is on sale.
-- It selected COALESCE(sale_price, price, 0) without checking on_sale,
-- the same bug class already fixed for reservations in
-- 20260722011025_reservation_respect_sale_price.sql. A product with a
-- stale sale_price left over after its sale ends (on_sale = false) would
-- silently undercharge every order for it.

CREATE OR REPLACE FUNCTION public.create_order(_shipping_address jsonb, _items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product record;
  v_quantity integer;
  v_total numeric := 0;
  v_display_id text;
  v_attempt integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'ORD-' || floor(100000 + random() * 900000)::text;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders WHERE display_id = v_display_id
    );

    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate order number.';
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    customer_id,
    display_id,
    total_amount,
    shipping_address,
    status
  )
  VALUES (
    v_user_id,
    v_display_id,
    0,
    _shipping_address,
    'paid'
  )
  RETURNING * INTO v_order;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

    IF v_quantity < 1 THEN
      RAISE EXCEPTION 'Item quantity must be positive.';
    END IF;

    SELECT
      id,
      CASE
        WHEN COALESCE(on_sale, false) AND sale_price IS NOT NULL AND sale_price > 0
          THEN sale_price
        ELSE COALESCE(price, 0)
      END::numeric AS unit_price
    INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND visibility = 'public'
      AND COALESCE(deleted, false) = false
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is unavailable.';
    END IF;

    IF v_product.unit_price <= 0 THEN
      RAISE EXCEPTION 'Product price is invalid.';
    END IF;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      quantity,
      unit_price,
      selected_size,
      selected_color
    )
    VALUES (
      v_order.id,
      v_product.id,
      v_quantity,
      v_product.unit_price,
      NULLIF(v_item->>'selected_size', ''),
      NULLIF(v_item->>'selected_color', '')
    );

    v_total := v_total + (v_product.unit_price * v_quantity);
  END LOOP;

  UPDATE public.orders
  SET total_amount = v_total
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN to_jsonb(v_order);
END;
$function$;
