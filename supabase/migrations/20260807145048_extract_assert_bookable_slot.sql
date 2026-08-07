-- One definition of "is this slot bookable".
--
-- The rules lived only inside the validate_reservation_time trigger, which
-- fires on reservations.date / appointment_time. A reschedule *request* writes
-- a proposed time to different columns, so the trigger would never see it --
-- and copying the rules into the request path is precisely how two versions of
-- the same rule drift apart. The trigger now delegates here.

CREATE OR REPLACE FUNCTION public.assert_bookable_slot(
  _date date,
  _appointment timestamptz,
  _exclude_reservation uuid DEFAULT NULL,
  _check_capacity boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  day_idx integer;
  standard_hours record;
  closure_record record;
  store_open time;
  store_close time;
  appt_time time;
  existing_count integer;
BEGIN
  IF _date IS NULL OR _appointment IS NULL THEN
    RETURN;
  END IF;

  appt_time := (_appointment AT TIME ZONE 'Asia/Manila')::time;

  IF (EXTRACT(minute FROM appt_time)::integer % 30) <> 0
     OR EXTRACT(second FROM appt_time)::integer <> 0 THEN
    RAISE EXCEPTION 'Appointment time must be on a 30-minute boundary.';
  END IF;

  day_idx := EXTRACT(dow FROM _date);

  SELECT * INTO standard_hours FROM public.store_hours WHERE day_of_week = day_idx;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store hours are not configured for this day.';
  END IF;

  SELECT * INTO closure_record FROM public.store_closures WHERE closure_date = _date;

  IF FOUND THEN
    IF COALESCE(closure_record.is_fully_closed, true) THEN
      RAISE EXCEPTION 'Boutique is closed on this date: %', COALESCE(closure_record.reason, 'Closed');
    END IF;
    store_open := COALESCE(closure_record.custom_open_time, standard_hours.open_time);
    store_close := COALESCE(closure_record.custom_close_time, standard_hours.close_time);
  ELSE
    IF COALESCE(standard_hours.is_closed, false) THEN
      RAISE EXCEPTION 'Boutique is normally closed on this day of the week.';
    END IF;
    store_open := standard_hours.open_time;
    store_close := standard_hours.close_time;
  END IF;

  IF store_open IS NULL OR store_close IS NULL OR store_open >= store_close THEN
    RAISE EXCEPTION 'Store hours are invalid for this date.';
  END IF;

  IF appt_time < store_open OR appt_time >= store_close THEN
    RAISE EXCEPTION 'Appointment time is outside of operating hours (% - %).', store_open, store_close;
  END IF;

  IF _check_capacity THEN
    SELECT count(*) INTO existing_count
    FROM public.reservations r
    WHERE r.date::date = _date
      AND (r.appointment_time AT TIME ZONE 'Asia/Manila')::time = appt_time
      AND COALESCE(r.deleted, false) = false
      AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
      AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation);

    IF existing_count >= 3 THEN
      RAISE EXCEPTION 'This time slot is fully booked. Please select another time.';
    END IF;
  END IF;
END;
$function$;

-- The trigger keeps its name and its behaviour; it just stops being the only
-- place the rules exist. Capacity is still skipped for cancelled and completed
-- rows, exactly as before.
CREATE OR REPLACE FUNCTION public.validate_reservation_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.date IS NULL OR NEW.appointment_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.assert_bookable_slot(
    NEW.date::date,
    NEW.appointment_time,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE NEW.id END,
    COALESCE(NEW.deleted, false) = false
      AND lower(COALESCE(NEW.status, 'pending')) NOT IN ('cancelled', 'completed')
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) FROM authenticated;
