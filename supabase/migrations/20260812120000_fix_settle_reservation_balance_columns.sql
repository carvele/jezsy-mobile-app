-- Fixes a bug introduced by 20260809190000_audit_remediation_pack.sql.
--
-- That migration redefined settle_reservation_balance() (correctly, to fix
-- audit finding F13) but in the same rewrite started writing two columns --
-- balance_settled_method and balance_settled_by_name -- that no migration
-- has ever created. The table only ever had balance_method and
-- balance_settled_by (see 20260807143459_reservations_balance_settlement.sql).
-- Every call to this RPC since has failed with "column does not exist",
-- meaning staff cannot record a balance collected at handover at all.
--
-- The same rewrite also silently dropped the guard requiring the deposit
-- (payment_status = 'paid') to have already cleared before a balance can be
-- settled. Restored here.
--
-- balance_method and balance_settled_by are left in place, unused but
-- harmless, rather than dropped -- narrower blast radius for a hotfix.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS balance_settled_method text,
  ADD COLUMN IF NOT EXISTS balance_settled_by_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_balance_settled_method_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_balance_settled_method_check
      CHECK (balance_settled_method IS NULL OR balance_settled_method IN ('cash','transfer','card','other'));
  END IF;
END $$;

COMMENT ON COLUMN public.reservations.balance_settled_method IS
  'How the balance was taken: cash, transfer, card or other. NULL when nothing has been collected. Successor to balance_method, which settle_reservation_balance() no longer writes.';
COMMENT ON COLUMN public.reservations.balance_settled_by_name IS
  'Denormalized name of the staff member who recorded the collection, captured at settlement time so it survives that profile later being scrubbed or renamed.';

CREATE OR REPLACE FUNCTION public.settle_reservation_balance(
  _reservation_id uuid,
  _method text DEFAULT 'cash'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_res record;
  v_outstanding numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can record a balance settlement.';
  END IF;

  IF _method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method.';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
  END IF;

  -- Restored: nothing is owed until the deposit itself has cleared. Before
  -- that the whole price is outstanding, which is the payment deadline's job
  -- to chase, not this RPC's.
  IF lower(COALESCE(v_res.payment_status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'The deposit has not been paid yet.';
  END IF;

  v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No balance is owed on this reservation.';
  END IF;

  UPDATE public.reservations
  SET balance_settled_at = now(),
      balance_settled_by = v_actor,
      balance_settled_by_name = COALESCE(v_actor_name, 'Staff'),
      balance_settled_method = _method
  WHERE id = _reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'settled_amount', v_outstanding,
    'method', _method,
    'settled_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_reservation_balance(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_reservation_balance(uuid, text) TO authenticated;
