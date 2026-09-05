DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-stale-reservations');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or unschedule failed, skipping';
END $$;

DROP FUNCTION IF EXISTS public.expire_all_stale_reservations();
