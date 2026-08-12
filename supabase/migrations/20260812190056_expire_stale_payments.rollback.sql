DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-payments');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.expire_stale_payments();
