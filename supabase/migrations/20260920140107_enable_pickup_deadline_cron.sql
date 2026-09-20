-- =============================================================================
-- 20260920140106_enable_pickup_deadline_cron.sql
--
-- Enables the pickup deadline cron sweep.
-- MUST NOT BE RUN until:
--   1. 20260920140105_pickup_policy_hardening has been applied and verified.
--   2. The E2E suite (e2e_test.sql) passes on an isolated database.
--   3. The shared-DB candidate SELECT returns 0 unexpected rows.
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
