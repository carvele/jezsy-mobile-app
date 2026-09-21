DO $function$
BEGIN
  PERFORM cron.unschedule('sweep-pickup-deadlines');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $function$;
