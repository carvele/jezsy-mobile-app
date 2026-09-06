CREATE OR REPLACE FUNCTION public.create_reservations_from_cart(_items jsonb, _pickup_date text, _pickup_time text, _display_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    INSERT INTO public.reservations (
      customer_id,
      product_id,
      quantity,
      size,
      color,
      rental_price,
      deposit,
      date,
      appointment_time,
      display_id,
      status,
      payment_status,
      payment_type
    ) VALUES (
      auth.uid(),
      (item->>'product_id')::uuid,
      (item->>'quantity')::int,
      item->>'selected_size',
      item->>'selected_color',
      (item->>'unit_price')::numeric,
      (item->>'deposit')::numeric,
      _pickup_date,
      _pickup_time,
      _display_id,
      'Pending',
      'Pending',
      'Deposit'
    );
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_reservations_from_cart(jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
