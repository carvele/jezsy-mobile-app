-- Booking capacity becomes data instead of a number written in two places.
--
-- The cap of three per 30-minute slot lived twice: hardcoded in
-- assert_bookable_slot, and again as SLOT_CAPACITY in the mobile TimeSlotPicker.
-- Changing one would have made the picker offer slots the server rejects, or
-- hide slots it would have accepted. store_hours already selects * on the
-- client, so moving it here gives both sides one answer.
--
-- Per day rather than global: a Saturday with more staff on can genuinely take
-- more fittings than a Tuesday, and that is a shop decision, not a code change.

ALTER TABLE public.store_hours
  ADD COLUMN IF NOT EXISTS slot_capacity integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_daily_bookings integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_hours_slot_capacity_check'
      AND conrelid = 'public.store_hours'::regclass
  ) THEN
    ALTER TABLE public.store_hours
      ADD CONSTRAINT store_hours_slot_capacity_check
      CHECK (slot_capacity >= 1 AND slot_capacity <= 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_hours_max_daily_bookings_check'
      AND conrelid = 'public.store_hours'::regclass
  ) THEN
    ALTER TABLE public.store_hours
      ADD CONSTRAINT store_hours_max_daily_bookings_check
      CHECK (max_daily_bookings IS NULL OR max_daily_bookings >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.store_hours.slot_capacity IS
  'How many reservations may share one 30-minute slot on this weekday. The mobile picker reads this too, so it is the only definition.';
COMMENT ON COLUMN public.store_hours.max_daily_bookings IS
  'Optional ceiling on reservations for the whole day. NULL means no daily limit, only the per-slot one.';

-- assert_bookable_slot now reads both rather than assuming three.
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
  day_total integer;
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

    IF existing_count >= COALESCE(standard_hours.slot_capacity, 3) THEN
      RAISE EXCEPTION 'This time slot is fully booked. Please select another time.';
    END IF;

    IF standard_hours.max_daily_bookings IS NOT NULL THEN
      SELECT count(*) INTO day_total
      FROM public.reservations r
      WHERE r.date::date = _date
        AND COALESCE(r.deleted, false) = false
        AND lower(COALESCE(r.status, 'pending')) NOT IN ('cancelled', 'completed')
        AND (_exclude_reservation IS NULL OR r.id <> _exclude_reservation);

      IF day_total >= standard_hours.max_daily_bookings THEN
        RAISE EXCEPTION 'This date is fully booked. Please select another day.';
      END IF;
    END IF;
  END IF;
END;
$function$;

-- One fitting per 30-minute slot, as agreed. A single UPDATE to change it,
-- with no deploy -- which is the point of moving it out of the code.
UPDATE public.store_hours SET slot_capacity = 1;
