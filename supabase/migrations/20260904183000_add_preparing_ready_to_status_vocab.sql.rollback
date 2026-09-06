ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'Pending', 'Request Approval', 'Confirmed', 'Approved', 'To Pay',
    'To Pickup', 'Fitting', 'Active', 'Completed', 'Cancelled'
  )) NOT VALID;

CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT coalesce(_deleted, false)
     AND lower(trim(coalesce(_status, ''))) IN (
       'approved', 'confirmed', 'to pay', 'to pickup', 'fitting', 'active'
     );
$function$;
