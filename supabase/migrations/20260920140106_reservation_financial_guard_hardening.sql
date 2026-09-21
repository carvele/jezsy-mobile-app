-- 20260920140106_reservation_financial_guard_hardening.sql
-- Fixes guard_reservation_financial_state() to allow Cancelled payment status when
-- every non-refunded settled payment is fully forfeited under the customer-fault
-- no-refund policy (forfeited_centavos = amount_centavos, requires_refund = false,
-- no outstanding refund obligation). Refund Required → Cancelled remains forbidden.
-- Direct authenticated lifecycle/payment-state manipulation remains blocked.

CREATE OR REPLACE FUNCTION public.guard_reservation_financial_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_all_forfeited boolean;
BEGIN

  -- Block 1: Authenticated users may not directly change lifecycle or payment state.
  -- All mutations must go through authorized reservation commands (RPCs).
  IF current_user = 'authenticated'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     ) THEN
    RAISE EXCEPTION 'Use an authorized reservation command to change lifecycle or payment state.'
      USING ERRCODE = '42501';
  END IF;

  -- Block 2: Settled/refundable payment status may not regress, with one narrow exception:
  --   Paid → Cancelled is permitted when every non-refunded settled payment is fully
  --   forfeited under the customer-fault no-refund policy.
  --   Refund Required → Cancelled remains unconditionally forbidden.
  IF lower(coalesce(OLD.payment_status, '')) IN ('paid', 'refund required')
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('paid', 'refund required', 'refunded')
  THEN
    IF lower(coalesce(OLD.payment_status, '')) = 'paid'
       AND lower(coalesce(NEW.payment_status, '')) = 'cancelled'
    THEN
      -- Allow only when every currently settled, non-refunded payment is fully forfeited
      -- with no outstanding refund obligation.
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.reservation_id = NEW.id
          AND p.status = 'paid'
          AND p.refund_disbursed_at IS NULL
          AND (
            coalesce(p.forfeited_centavos, 0) <> p.amount_centavos
            OR coalesce(p.requires_refund, false) = true
            OR coalesce(p.refund_required_centavos, 0) > 0
            OR p.refund_required_at IS NOT NULL
          )
      ) INTO v_all_forfeited;

      IF NOT v_all_forfeited THEN
        RAISE EXCEPTION 'Settled payment cannot be cancelled: not all settled amounts are fully forfeited with no refund obligation.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'Settled or refundable payment cannot be marked unpaid or cancelled.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Block 3: Cancelled payment_status is only allowed when every non-refunded settled
  -- payment is fully accounted as forfeited. A payment remains historically 'paid' after
  -- forfeiture; the accounting is captured by forfeited_centavos = amount_centavos with
  -- no refund obligation. Un-forfeited payments indicate an unresolved obligation.
  IF lower(coalesce(NEW.payment_status, '')) = 'cancelled'
     AND EXISTS (
       SELECT 1
       FROM public.payments p
       WHERE p.reservation_id = NEW.id
         AND p.status = 'paid'
         AND p.refund_disbursed_at IS NULL
         AND (
           coalesce(p.forfeited_centavos, 0) <> p.amount_centavos
           OR coalesce(p.requires_refund, false) = true
           OR coalesce(p.refund_required_centavos, 0) > 0
           OR p.refund_required_at IS NOT NULL
         )
     )
  THEN
    RAISE EXCEPTION 'Cannot cancel payment obligation: unaccounted settled payments exist for this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Block 4: A cancelled reservation must carry an appropriate payment status.
  IF lower(coalesce(NEW.status, '')) = 'cancelled'
     AND lower(coalesce(NEW.payment_status, '')) NOT IN ('cancelled', 'refund required', 'refunded')
  THEN
    RAISE EXCEPTION 'A cancelled reservation must have payment status of Cancelled, Refund Required, or Refunded.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Block 5: Terminal reservations cannot be reopened.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(OLD.status, '')) IN ('cancelled', 'completed')
  THEN
    RAISE EXCEPTION 'A terminal reservation cannot be reopened or changed.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Block 6: Payment must be confirmed before a reservation is moved to Preparing/Ready/To Pickup.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND lower(coalesce(NEW.status, '')) IN ('preparing', 'ready', 'to pickup')
     AND lower(coalesce(NEW.payment_status, '')) <> 'paid'
  THEN
    RAISE EXCEPTION 'Payment must be confirmed before preparing this reservation.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Grant: trigger function is SECURITY INVOKER so inherits caller. No additional grants needed.
-- Verify the guard is in place.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'trg_guard_reservation_financial_state'
      AND c.relname = 'reservations'
  ) THEN
    RAISE EXCEPTION 'Guard trigger not found on reservations. Aborting migration.';
  END IF;
END $$;
