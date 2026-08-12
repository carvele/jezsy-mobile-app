-- Reconciles public.payments rows that never resolve.
--
-- The webhook only marks a row 'paid'/'failed' when PayMongo actually
-- delivers checkout_session.payment.paid / payment.failed / (as of the
-- companion payments-webhook deploy) checkout_session.expired. If delivery
-- is lost, or the customer abandons the checkout before PayMongo ever
-- creates a payment object, the row sits at 'awaiting_payment' forever --
-- expire_unpaid_reservations() cancels the *reservation* on the same kind
-- of staleness but has never touched this table, so the transaction record
-- outlives the reservation it was for.
--
-- 2 hours is a safety margin well past normal checkout completion, not an
-- attempt to model PayMongo's own session expiry. Marking a row 'failed'
-- here does not foreclose a legitimate late webhook: payments-webhook only
-- refuses to walk a row backwards away from 'paid' (payment.status ===
-- 'paid' guard), so a delayed paid event still lands correctly on top of a
-- row this function already marked 'failed'.

CREATE OR REPLACE FUNCTION public.expire_stale_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer;
BEGIN
  WITH stale AS (
    UPDATE public.payments
    SET status = 'failed'
    WHERE status IN ('awaiting_payment', 'processing')
      AND created_at < now() - interval '2 hours'
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM stale;

  RETURN v_expired;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_payments() FROM public, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-runnable: unschedule first, since cron.schedule on an existing job name
-- raises rather than replacing.
DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-payments');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire-stale-payments',
  '*/5 * * * *',
  $job$ SELECT public.expire_stale_payments(); $job$
);
