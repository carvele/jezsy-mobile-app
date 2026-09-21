-- =============================================================================
-- 20260920140100_enable_pickup_deadline_cron.sql
--
-- Enables the pickup deadline cron sweep.
-- MUST NOT BE RUN until the backfill in 20260920140000 has been manually
-- verified to ensure no unintended auto-cancellations will occur.
-- =============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-pickup-deadlines');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sweep-pickup-deadlines',
  '*/15 * * * *',
  $$ SELECT public.sweep_pickup_deadlines(); $$
);
