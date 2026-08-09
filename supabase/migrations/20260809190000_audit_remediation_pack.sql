-- Migration: Audit Remediation Pack for F13, F16, F21
-- 1. F13: Harden settle_reservation_balance and resolve_reschedule to use is_staff_or_admin()
CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res record;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = COALESCE(v_actor_name, 'Staff'),
      balance_settled_method = _method
  WHERE id = _reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_reschedule(
  _reservation_id uuid,
  _approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_res record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can resolve a reschedule request.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending reschedule request for this reservation.';
  END IF;

  IF _approve THEN
    PERFORM public.assert_bookable_slot(
      v_res.reschedule_proposed_date,
      v_res.reschedule_proposed_time,
      _reservation_id
    );

    UPDATE public.reservations
    SET date = v_res.reschedule_proposed_date,
        appointment_time = v_res.reschedule_proposed_time,
        reschedule_status = 'approved',
        reschedule_requested_at = NULL,
        reschedule_proposed_date = NULL,
        reschedule_proposed_time = NULL
    WHERE id = _reservation_id;
  ELSE
    UPDATE public.reservations
    SET reschedule_status = 'declined',
        reschedule_requested_at = NULL,
        reschedule_proposed_date = NULL,
        reschedule_proposed_time = NULL
    WHERE id = _reservation_id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'approved', _approve
  );
END;
$function$;

-- 2. F16: Fix legacy create_reservation to multiply unit deposit by quantity
CREATE OR REPLACE FUNCTION public.create_reservation(
  _product_id uuid,
  _size text,
  _color text,
  _date date,
  _appointment_time timestamptz,
  _payment_option text DEFAULT 'deposit'::text,
  _receipt_path text DEFAULT NULL::text,
  _quantity integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_product record;
  v_deposit numeric;
  v_total numeric;
  v_payment_type text;
  v_reservation_id uuid;
  v_display_id text;
  v_seq integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be logged in to create a reservation.';
  END IF;

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.profiles
  WHERE id = v_user_id AND deleted = false;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = _product_id;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.';
  END IF;

  PERFORM public.assert_bookable_slot(_date, _appointment_time, NULL);

  v_total := round(v_product.price * _quantity, 2);
  IF _payment_option = 'full' THEN
    v_deposit := v_total;
    v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_product.price * 0.5 * _quantity, 2);
    v_payment_type := 'Deposit';
  END IF;

  INSERT INTO public.reservation_seq DEFAULT VALUES RETURNING id INTO v_seq;
  v_display_id := 'RES-' || lpad(v_seq::text, 6, '0');
  v_reservation_id := gen_random_uuid();

  INSERT INTO public.reservations (
    id, display_id, customer_id, customer_name, product_id, product_name,
    image_url, date, appointment_time, status, size, color, quantity,
    rental_price, deposit, deposit_amount, payment_option, payment_type,
    receipt_path, deleted
  ) VALUES (
    v_reservation_id, v_display_id, v_user_id, COALESCE(v_user_name, 'Customer'),
    v_product.id, v_product.name, v_product.image_url, _date, _appointment_time,
    'Pending', NULLIF(_size, ''), NULLIF(_color, ''), _quantity,
    v_total, v_deposit, v_deposit, _payment_option, v_payment_type,
    _receipt_path, false
  );

  INSERT INTO public.reservation_items (
    reservation_id, product_id, product_name, image_url, size, color, quantity, unit_price
  ) VALUES (
    v_reservation_id, v_product.id, v_product.name, v_product.image_url,
    NULLIF(_size, ''), NULLIF(_color, ''), _quantity, v_product.price
  );

  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'display_id', v_display_id,
    'deposit', v_deposit,
    'rental_price', v_total
  );
END;
$function$;
