-- Migration: Reservation Time Validation and Payment Receipt

-- 1. Create store_hours table
CREATE TABLE IF NOT EXISTS store_hours (
    day_of_week integer PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
    open_time time NOT NULL,
    close_time time NOT NULL,
    is_closed boolean DEFAULT false
);

-- Default schedule: Monday-Saturday 10:00 - 20:00, Sunday Closed
INSERT INTO store_hours (day_of_week, open_time, close_time, is_closed) VALUES
(0, '10:00:00', '20:00:00', true),  -- Sunday
(1, '10:00:00', '20:00:00', false), -- Monday
(2, '10:00:00', '20:00:00', false), -- Tuesday
(3, '10:00:00', '20:00:00', false), -- Wednesday
(4, '10:00:00', '20:00:00', false), -- Thursday
(5, '10:00:00', '20:00:00', false), -- Friday
(6, '10:00:00', '20:00:00', false)  -- Saturday
ON CONFLICT (day_of_week) DO NOTHING;

-- 2. Create store_closures table
CREATE TABLE IF NOT EXISTS store_closures (
    closure_date date PRIMARY KEY,
    reason text,
    is_fully_closed boolean DEFAULT true,
    custom_open_time time,
    custom_close_time time
);

-- 3. Update reservations table
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS payment_receipt_url text;

-- 4. Create trigger to validate reservation time and capacity (max 3 per 30-min slot)
CREATE OR REPLACE FUNCTION validate_reservation_time()
RETURNS TRIGGER AS $$
DECLARE
    day_idx integer;
    store_open time;
    store_close time;
    is_store_closed boolean;
    closure_record record;
    appt_time time;
    existing_count integer;
BEGIN
    -- Only validate if date and appointment_time are provided
    IF NEW.date IS NULL OR NEW.appointment_time IS NULL THEN
        RETURN NEW;
    END IF;

    -- Extract time from appointment_time (e.g. '10:00 AM' -> '10:00:00')
    appt_time := NEW.appointment_time::time;
    
    -- Extract day of week (0 = Sunday, 6 = Saturday)
    day_idx := extract(dow from NEW.date::timestamp);

    -- Check if there is a store closure or custom hours
    SELECT * INTO closure_record FROM store_closures WHERE closure_date = NEW.date::date;
    IF FOUND THEN
        IF closure_record.is_fully_closed THEN
            RAISE EXCEPTION 'Boutique is closed on this date: %', closure_record.reason;
        END IF;
        store_open := closure_record.custom_open_time;
        store_close := closure_record.custom_close_time;
    ELSE
        -- Standard hours
        SELECT open_time, close_time, is_closed INTO store_open, store_close, is_store_closed 
        FROM store_hours WHERE day_of_week = day_idx;
        
        IF is_store_closed THEN
            RAISE EXCEPTION 'Boutique is normally closed on this day of the week.';
        END IF;
    END IF;

    -- Validate time bounds
    IF appt_time < store_open OR appt_time >= store_close THEN
        RAISE EXCEPTION 'Appointment time is outside of operating hours (% - %).', store_open, store_close;
    END IF;

    -- Validate capacity (max 3 reservations per slot)
    SELECT count(*) INTO existing_count FROM reservations 
    WHERE date::date = NEW.date::date AND appointment_time = NEW.appointment_time;

    -- If this is an insert (TG_OP = INSERT) or an update to a new time
    IF existing_count >= 3 THEN
        RAISE EXCEPTION 'This time slot is fully booked. Please select another time.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_reservation_time ON reservations;
CREATE TRIGGER trg_validate_reservation_time
BEFORE INSERT OR UPDATE OF date, appointment_time ON reservations
FOR EACH ROW
EXECUTE FUNCTION validate_reservation_time();
