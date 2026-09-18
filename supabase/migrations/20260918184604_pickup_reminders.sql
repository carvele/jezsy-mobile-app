-- Adds automated 24-hour and 1-hour pickup reminders, following the exact
-- pattern already established by send_payment_deadline_reminders(): a
-- SECURITY DEFINER sweep function on a pg_cron schedule, writing into the
-- existing notifications table, picked up by the existing
-- dispatch_pending_push() delivery pipeline. No new dispatch architecture.
--
-- Idempotency is stronger here than the payment-deadline precedent needs,
-- because a pickup appointment CAN be rescheduled after a reminder already
-- fired (a payment deadline cannot). Rather than a plain "sent_at" flag,
-- each marker records the appointment_time the reminder was sent FOR. A
-- reschedule changes appointment_time, which makes the stored marker stop
-- matching the live value -- the reminder window re-opens automatically for
-- the new time, with no trigger needed to reset anything.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS pickup_reminder_24h_sent_for timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_reminder_1h_sent_for timestamptz;

COMMENT ON COLUMN public.reservations.pickup_reminder_24h_sent_for IS
  'The appointment_time value send_pickup_reminders() last sent a 24h reminder for. NULL, or stale after a reschedule, means the 24h reminder can fire again.';
COMMENT ON COLUMN public.reservations.pickup_reminder_1h_sent_for IS
  'The appointment_time value send_pickup_reminders() last sent a 1h reminder for. NULL, or stale after a reschedule, means the 1h reminder can fire again.';

CREATE OR REPLACE FUNCTION public.send_pickup_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_24h_ids uuid[];
  v_1h_ids uuid[];
  v_sent integer := 0;
BEGIN
  -- 24-hour reminders. appointment_time is timestamptz (see
  -- 20260730002045_appointment_time_timestamptz.sql) so this comparison is
  -- timezone-agnostic; Asia/Manila is only applied below for the human-
  -- readable notification body.
  SELECT array_agg(id) INTO v_24h_ids
  FROM (
    SELECT r.id
    FROM public.reservations r
    WHERE coalesce(r.deleted, false) = false
      AND r.customer_id IS NOT NULL
      -- Excluded rather than allow-listed, so a future intermediate status
      -- still gets reminders without needing another migration.
      AND lower(trim(coalesce(r.status, ''))) NOT IN ('completed', 'cancelled')
      AND r.appointment_time IS NOT NULL
      AND r.appointment_time > now()
      AND r.appointment_time <= now() + interval '24 hours'
      AND (r.pickup_reminder_24h_sent_for IS NULL
           OR r.pickup_reminder_24h_sent_for <> r.appointment_time)
    FOR UPDATE OF r SKIP LOCKED
  ) c;

  IF v_24h_ids IS NOT NULL AND array_length(v_24h_ids, 1) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT r.customer_id, 'reservation', 'Pickup tomorrow',
      coalesce(r.product_name, 'Your reservation') || ' -- ready for pickup '
        || to_char(r.appointment_time AT TIME ZONE 'Asia/Manila', 'Mon DD, HH12:MI AM') || '.',
      jsonb_build_object('reservation_id', r.id, 'display_id', r.display_id)
    FROM public.reservations r
    WHERE r.id = ANY(v_24h_ids);

    UPDATE public.reservations
    SET pickup_reminder_24h_sent_for = appointment_time
    WHERE id = ANY(v_24h_ids);

    v_sent := v_sent + array_length(v_24h_ids, 1);
  END IF;

  -- 1-hour reminders. Same shape, tighter window, separate marker column so
  -- the two reminders are independent (a rescheduled appointment less than
  -- 24h out still gets both, in order).
  SELECT array_agg(id) INTO v_1h_ids
  FROM (
    SELECT r.id
    FROM public.reservations r
    WHERE coalesce(r.deleted, false) = false
      AND r.customer_id IS NOT NULL
      AND lower(trim(coalesce(r.status, ''))) NOT IN ('completed', 'cancelled')
      AND r.appointment_time IS NOT NULL
      AND r.appointment_time > now()
      AND r.appointment_time <= now() + interval '1 hour'
      AND (r.pickup_reminder_1h_sent_for IS NULL
           OR r.pickup_reminder_1h_sent_for <> r.appointment_time)
    FOR UPDATE OF r SKIP LOCKED
  ) c;

  IF v_1h_ids IS NOT NULL AND array_length(v_1h_ids, 1) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT r.customer_id, 'reservation', 'Pickup in about an hour',
      coalesce(r.product_name, 'Your reservation') || ' -- ready for pickup at '
        || to_char(r.appointment_time AT TIME ZONE 'Asia/Manila', 'HH12:MI AM') || '.',
      jsonb_build_object('reservation_id', r.id, 'display_id', r.display_id)
    FROM public.reservations r
    WHERE r.id = ANY(v_1h_ids);

    UPDATE public.reservations
    SET pickup_reminder_1h_sent_for = appointment_time
    WHERE id = ANY(v_1h_ids);

    v_sent := v_sent + array_length(v_1h_ids, 1);
  END IF;

  RETURN v_sent;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_pickup_reminders() FROM PUBLIC, anon, authenticated;

-- Re-runnable: unschedule first, since cron.schedule on an existing job name
-- raises rather than replacing. Every 15 minutes per the approved scope --
-- frequent enough that the 24h/1h windows are never missed by more than one
-- tick, without adding meaningful load next to the existing 5-minute
-- payment-deadline sweep and 1-minute push dispatcher.
DO $$
BEGIN
  PERFORM cron.unschedule('send-pickup-reminders');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-pickup-reminders',
  '*/15 * * * *',
  $job$ SELECT public.send_pickup_reminders(); $job$
);
