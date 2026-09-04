-- Replaces the client-side autoCancelExpiredReservations polling with an atomic
-- server-side sweep. 
--
-- Finding: Client-Side Auto-Cancellation Race Conditions (Code Review Ultra)

CREATE OR REPLACE FUNCTION public.expire_all_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
  v_buffer interval := interval '5 minutes';
BEGIN
  -- We cancel:
  -- 1. Pending/Request Approval where appointment_time has passed (missed review)
  -- 2. To Pay/Confirmed where payment_due_at has passed (missed payment window)
  -- 3. To Pay/Confirmed where appointment_time has passed (missed appointment completely)

  WITH expired AS (
    UPDATE public.reservations
    SET 
      status = 'Cancelled',
      cancellation_reason = CASE
        WHEN lower(trim(coalesce(status, ''))) IN ('pending', 'request approval') THEN 'Auto-cancelled: Appointment window passed without review'
        WHEN payment_due_at IS NOT NULL AND payment_due_at + v_buffer < now() THEN 'Auto-cancelled: Payment deadline passed'
        ELSE 'Auto-cancelled: Appointment time passed without payment'
      END,
      updated_at = now()
    WHERE COALESCE(deleted, false) = false
      AND (
        (
          lower(trim(coalesce(status, ''))) IN ('pending', 'request approval')
          AND appointment_time IS NOT NULL 
          AND appointment_time + v_buffer < now()
        )
        OR
        (
          lower(trim(coalesce(status, ''))) IN ('to pay', 'confirmed')
          AND (
            (payment_due_at IS NOT NULL AND payment_due_at + v_buffer < now())
            OR 
            (appointment_time IS NOT NULL AND appointment_time + v_buffer < now())
          )
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_all_stale_reservations() FROM PUBLIC, anon, authenticated;

-- If pg_cron is enabled, schedule this to run every minute.
-- (This gracefully fails if the extension is not installed/allowed for the current user)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('expire-stale-reservations', '* * * * *', 'SELECT public.expire_all_stale_reservations()');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or schedule failed, skipping cron setup';
END $$;
