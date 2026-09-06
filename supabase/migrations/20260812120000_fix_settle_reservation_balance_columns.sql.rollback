-- Rollback for 20260812120000_fix_settle_reservation_balance_columns.sql.
-- Restores the exact (broken) state from 20260809190000_audit_remediation_pack.sql:
-- settle_reservation_balance() writing to columns that do not exist, and no
-- payment_status guard. Only use this to revert, not as a template.

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

  SELECT full_name INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor AND deleted = false AND is_blocked = false;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.balance_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Balance has already been settled for this reservation.';
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

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_balance_settled_method_check;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS balance_settled_method,
  DROP COLUMN IF EXISTS balance_settled_by_name;
