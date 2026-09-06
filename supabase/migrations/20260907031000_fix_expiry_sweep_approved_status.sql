-- RES-002: expire_all_stale_reservations() omitted 'approved' from the
-- payment-deadline branch while every other part of the codebase (dashboard,
-- statusBucket, isAwaitingPayment) treats 'Approved' as a synonym for
-- 'Confirmed'/'To Pay'. The appointment-passed sub-branch also lacked it.
-- Low real-world impact (the 24h payment_due_at sweep catches most cases) but
-- aligns the function with the rest of the status vocabulary.

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
  -- 2. To Pay/Confirmed/Approved where payment_due_at has passed (missed payment window)
  -- 3. To Pay/Confirmed/Approved where appointment_time has passed (missed appointment completely)

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
          -- Added 'approved': treated as awaiting payment everywhere else in the codebase.
          lower(trim(coalesce(status, ''))) IN ('to pay', 'confirmed', 'approved')
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
