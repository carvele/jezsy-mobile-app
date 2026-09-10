-- Customer payment deadlines already exist (payment_due_at) and are already
-- enforced (expire_all_stale_reservations auto-cancels, notify_reservation_status_change
-- notifies on that cancellation). The one real gap: nothing warns the customer
-- *before* the window closes -- they only hear about it after it's too late.
--
-- Adds a one-shot reminder, sent once per reservation when its payment_due_at
-- is within 30 minutes, via the same notifications table + push pipeline
-- (dispatch_pending_push) already used everywhere else in this app.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.reservations.payment_reminder_sent_at IS
  'Set once send_payment_deadline_reminders() has notified the customer their payment window is closing soon. Prevents re-notifying every time its cron tick runs.';

CREATE OR REPLACE FUNCTION public.send_payment_deadline_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids uuid[];
  v_sent integer;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT r.id
    FROM public.reservations r
    WHERE coalesce(r.deleted, false) = false
      AND r.customer_id IS NOT NULL
      AND lower(trim(coalesce(r.status, ''))) IN ('confirmed', 'approved', 'to pay')
      AND lower(trim(coalesce(r.payment_status, ''))) NOT IN ('paid', 'submitted', 'processing', 'refund required')
      AND r.payment_due_at IS NOT NULL
      AND r.payment_due_at > now()
      AND r.payment_due_at <= now() + interval '30 minutes'
      AND r.payment_reminder_sent_at IS NULL
    FOR UPDATE OF r SKIP LOCKED
  ) c;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.customer_id, 'reservation', 'Payment window closing soon',
    coalesce(r.product_name, 'Your reservation') || ' -- pay by '
      || to_char(r.payment_due_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')
      || ' to keep it.',
    jsonb_build_object('reservation_id', r.id, 'display_id', r.display_id)
  FROM public.reservations r
  WHERE r.id = ANY(v_ids);

  UPDATE public.reservations
  SET payment_reminder_sent_at = now()
  WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_sent = ROW_COUNT;
  RETURN v_sent;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_payment_deadline_reminders() FROM PUBLIC, anon, authenticated;

-- Re-runnable: unschedule first, since cron.schedule on an existing job name
-- raises rather than replacing.
DO $$
BEGIN
  PERFORM cron.unschedule('send-payment-deadline-reminders');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-payment-deadline-reminders',
  '*/5 * * * *',
  $job$ SELECT public.send_payment_deadline_reminders(); $job$
);
