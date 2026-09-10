-- check_unattended_reservations() is dead code: 'Pending'/'pending' was
-- retired from reservations_status_check in 20260911110000, so no row can
-- ever match lower(status) = 'pending' and unattended_count is always 0.
-- It also posts to https://.../functions/v1/send-unattended-alert, which
-- does not exist under supabase/functions/, using a literal placeholder
-- auth header. Its supporting partial index served only this dead query.
--
-- auto_cancel_reservations_5m is a redundant 5-minute cron: its target,
-- auto_cancel_expired_reservations(), is only a thin wrapper around
-- public.expire_all_stale_reservations(), which the 1-minute
-- expire-stale-reservations job already calls directly. Only the
-- 1-minute job is kept as the authoritative schedule.

DROP FUNCTION IF EXISTS public.check_unattended_reservations();
DROP INDEX IF EXISTS public.reservations_pending_unattended_idx;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-unattended-reservations-cron') THEN
    PERFORM cron.unschedule('check-unattended-reservations-cron');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_cancel_reservations_5m') THEN
    PERFORM cron.unschedule('auto_cancel_reservations_5m');
  END IF;
END $$;
