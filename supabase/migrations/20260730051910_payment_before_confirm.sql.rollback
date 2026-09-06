-- Reverts 20260730051910_payment_before_confirm.sql
--
-- Restores the 20260730050945 shape: deadline set on the confirm transition,
-- sweep targeting Confirmed. That is the WRONG business rule -- payment comes
-- before confirmation -- so this exists for completeness, not because you should
-- want it.
--
-- Leaves the pg_cron EXTENSION in place and only unschedules the job. Dropping
-- the extension would take out any other job on this shared database.

DO $$
BEGIN
  PERFORM cron.unschedule('expire-unpaid-reservations');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.set_payment_due_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'confirmed'
     AND lower(COALESCE(OLD.status, '')) <> 'confirmed'
     AND lower(COALESCE(NEW.payment_status, '')) <> 'paid' THEN
    NEW.payment_due_at := COALESCE(NEW.payment_due_at, now() + interval '120 minutes');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_payment_due_on_confirm ON public.reservations;
CREATE TRIGGER trg_set_payment_due_on_confirm
BEFORE UPDATE ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.set_payment_due_on_confirm();

REVOKE EXECUTE ON FUNCTION public.set_payment_due_on_confirm() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservations
    SET status = 'Cancelled'
    WHERE lower(COALESCE(status, '')) = 'confirmed'
      AND lower(COALESCE(payment_status, '')) <> 'paid'
      AND payment_due_at IS NOT NULL
      AND payment_due_at < now()
      AND COALESCE(deleted, false) = false
    RETURNING id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_unpaid_reservations() FROM PUBLIC, anon, authenticated;

-- create_reservation is NOT reverted here: the only difference is the
-- payment_due_at stamp at INSERT, which is harmless when the trigger also sets
-- it. Reverting it would risk reintroducing a pre-Asia/Manila body by mistake,
-- which is the failure mode this whole sequence exists to avoid. Use
-- 20260730050945_reservation_payment_window.sql if you genuinely need that body.
