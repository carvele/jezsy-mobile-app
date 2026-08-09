-- Enable pg_cron and pg_net extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create an RPC to find unattended reservations and trigger a webhook
CREATE OR REPLACE FUNCTION public.check_unattended_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  unattended_count int;
  webhook_url text;
BEGIN
  -- Count how many pending reservations were created over 15 minutes ago
  SELECT count(*) INTO unattended_count
  FROM public.reservations
  WHERE status = 'pending' 
    AND created_at < now() - interval '15 minutes';

  IF unattended_count > 0 THEN
    -- Get project reference URL or use environment variables, here we assume it hits our edge function
    -- Ideally, webhook_url would be loaded from a vault or secrets table, 
    -- but for this migration we'll trigger a standard Supabase edge function path.
    -- (In production, replace 'https://wufcmtndotfvxvvxkamv.supabase.co' with your project URL)
    webhook_url := 'https://wufcmtndotfvxvvxkamv.supabase.co/functions/v1/send-unattended-alert';
    
    PERFORM net.http_post(
      url := webhook_url,
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer anon_key_placeholder"}'::jsonb,
      body := jsonb_build_object('unattended_count', unattended_count, 'message', 'There are unattended pending reservations.')
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every 5 minutes
SELECT cron.schedule(
  'check-unattended-reservations-cron',
  '*/5 * * * *',
  $$ SELECT public.check_unattended_reservations(); $$
);
