-- Migration: Progressive Commitment & Sanitized Public Projections
-- Description:
--   1. Introduces public.product_variants sanitized view (boolean stock flags, no numeric counts).
--   2. Restricts direct SELECT on raw public.inventory to staff/admin/owner only.
--   3. Restricts direct SELECT on public.settings to admin/owner only.
--   4. Creates public.get_public_store_setting(text) allowlisted RPC.
--   5. Enforces staff transactional isolation at DB/RPC layer for reservations, reviews, and conversations.
--   6. Pins SET search_path = public on public.search_catalog.

-- 1. Sanitized public.product_variants View
CREATE OR REPLACE VIEW public.product_variants AS
SELECT
  i.id,
  i.product_doc_id,
  i.sku,
  i.size,
  i.color,
  i.hex_color,
  i.pattern,
  (i.available > 0) AS is_available,
  (i.available > 0 AND i.available <= 3) AS is_low_stock,
  CASE
    WHEN i.available <= 0 THEN 'sold_out'
    WHEN i.available <= 3 THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM public.inventory i
JOIN public.products p ON p.id = i.product_doc_id
WHERE i.deleted = false
  AND p.deleted = false
  AND p.visibility = 'public';

ALTER VIEW public.product_variants OWNER TO postgres;
GRANT SELECT ON public.product_variants TO anon, authenticated;

-- 2. Restrict Direct SELECT on public.inventory to Staff/Admin/Owner
DROP POLICY IF EXISTS "Inventory select" ON public.inventory;

CREATE POLICY "Inventory select"
ON public.inventory FOR SELECT
TO authenticated
USING (public.is_staff_or_admin());

-- 3. Restrict Direct SELECT on public.settings to Admin/Owner Only
DROP POLICY IF EXISTS "Enable read access for all users" ON public.settings;
DROP POLICY IF EXISTS "Staff and admin can view settings" ON public.settings;

CREATE POLICY "Admin and owner can view settings"
ON public.settings FOR SELECT
TO authenticated
USING (public.is_admin_or_owner());

-- 4. Public Store Setting Accessor RPC
CREATE OR REPLACE FUNCTION public.get_public_store_setting(setting_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF setting_key NOT IN ('boutique_hours', 'store_contact', 'announcement_banner') THEN
    RETURN NULL;
  END IF;

  RETURN (SELECT value FROM public.settings WHERE key = setting_key);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_store_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store_setting(text) TO anon, authenticated;

-- 5. Staff Transactional Isolation: Reviews
DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;

CREATE POLICY "Customers can insert reviews for reserved products"
ON public.reviews FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'customer'
  )
  AND EXISTS (
    SELECT 1 FROM public.reservation_items ri
    JOIN public.reservations r ON r.id = ri.reservation_id
    WHERE r.customer_id = auth.uid()
      AND ri.product_id = reviews.product_id
      AND coalesce(r.deleted, false) = false
      AND r.status = 'Completed'
  )
);

CREATE OR REPLACE FUNCTION public.submit_verified_review(
  p_reservation_item_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL,
  p_images text[] DEFAULT '{}'::text[]
)
RETURNS public.reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_size text;
  v_color text;
  v_customer_id uuid;
  v_status text;
  v_new_review public.reviews;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Staff transactional isolation: reject staff/admin/owner accounts
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot submit customer reviews. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  SELECT ri.product_id, ri.size, ri.color, res.customer_id, res.status
  INTO v_product_id, v_size, v_color, v_customer_id, v_status
  FROM public.reservation_items ri
  JOIN public.reservations res ON res.id = ri.reservation_id
  WHERE ri.id = p_reservation_item_id
    AND coalesce(res.deleted, false) = false;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Reservation item not found';
  END IF;

  IF v_customer_id <> v_uid THEN
    RAISE EXCEPTION 'You can only review items from your own reservations';
  END IF;

  IF v_status <> 'Completed' THEN
    RAISE EXCEPTION 'Only completed reservations can be reviewed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reviews
    WHERE product_id = v_product_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'You have already reviewed this product';
  END IF;

  INSERT INTO public.reviews (
    product_id,
    user_id,
    reservation_item_id,
    size,
    color,
    rating,
    comment,
    images,
    verified_purchase
  ) VALUES (
    v_product_id,
    v_uid,
    p_reservation_item_id,
    v_size,
    v_color,
    p_rating,
    p_comment,
    p_images,
    true
  )
  RETURNING * INTO v_new_review;

  RETURN v_new_review;
END;
$$;

-- 6. Staff Transactional Isolation: Support Conversations
DROP POLICY IF EXISTS "Enable insert for own conversation or admin" ON public.conversations;

CREATE POLICY "Enable insert for own conversation or admin"
ON public.conversations FOR INSERT
TO authenticated
WITH CHECK (
  (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'customer'
    )
  )
  OR (
    public.is_staff_or_admin()
    AND customer_id <> auth.uid()
  )
);

-- 7. Staff Transactional Isolation: Reservations (create_reservation single-item fallback)
CREATE OR REPLACE FUNCTION public.create_reservation(
  _product_id uuid,
  _size text,
  _color text,
  _quantity integer,
  _date text,
  _appointment_time text,
  _receipt_path text,
  _payment_option text DEFAULT 'deposit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_product record;
  v_reservation public.reservations%rowtype;
  v_display_id text;
  v_attempt integer := 0;
  v_deposit numeric;
  v_appointment timestamptz;
  v_option text := lower(coalesce(_payment_option, 'deposit'));
  v_payment_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Staff transactional isolation: reject staff/admin/owner accounts
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot create customer reservations. Please use a personal customer account.'
      USING ERRCODE = '42501';
  END IF;

  IF v_option NOT IN ('deposit', 'full') THEN
    RAISE EXCEPTION 'Payment option must be deposit or full.';
  END IF;
  IF _quantity IS NULL OR _quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be positive.';
  END IF;
  IF _receipt_path IS NOT NULL AND _receipt_path <> ''
     AND (string_to_array(_receipt_path, '/'))[1] <> v_user_id::text THEN
    RAISE EXCEPTION 'Receipt does not belong to the current user.';
  END IF;
  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A reservation date and appointment time are required.';
  END IF;

  v_appointment := (_date::date + _appointment_time::time) AT TIME ZONE 'Asia/Manila';

  SELECT id, name, image_url,
    CASE WHEN COALESCE(on_sale, false) AND sale_price IS NOT NULL AND sale_price > 0
      THEN sale_price ELSE COALESCE(price, 0) END::numeric AS price
  INTO v_product FROM public.products
  WHERE id = _product_id AND visibility = 'public' AND COALESCE(deleted, false) = false
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product is unavailable.';
  END IF;
  IF v_product.price <= 0 THEN
    RAISE EXCEPTION 'Product price is invalid.';
  END IF;

  SELECT first_name, last_name INTO v_profile FROM public.profiles WHERE id = v_user_id;

  IF v_option = 'full' THEN
    v_deposit := round(v_product.price, 2);
    v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_product.price * 0.5, 2);
    v_payment_type := 'Deposit';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_display_id := 'RES-' || upper(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint))
                    || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations WHERE display_id = v_display_id);
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate reservation number.';
    END IF;
  END LOOP;

  INSERT INTO public.reservations (
    display_id, customer_id, customer_name, product_id, product_name,
    image_url, size, color, quantity, rental_price, deposit,
    date, appointment_time, receipt_url, status,
    payment_status, payment_type, payment_due_at,
    purchase_mode, sales_channel
  ) VALUES (
    v_display_id, v_user_id,
    COALESCE(NULLIF(trim(concat_ws(' ', v_profile.first_name, v_profile.last_name)), ''), 'Customer'),
    v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity,
    v_product.price, v_deposit,
    _date::date, v_appointment,
    NULLIF(_receipt_path, ''), 'Pending', 'Pending', v_payment_type,
    NULL,
    'reservation', 'mobile'
  ) RETURNING * INTO v_reservation;

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url,
    size, color, quantity, unit_price
  ) VALUES (
    v_reservation.id, v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity, v_product.price
  );

  RETURN to_jsonb(v_reservation);
END;
$$;

-- 8. Defense-in-depth: Pin search_path on search_catalog
ALTER FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text) SET search_path = public;
