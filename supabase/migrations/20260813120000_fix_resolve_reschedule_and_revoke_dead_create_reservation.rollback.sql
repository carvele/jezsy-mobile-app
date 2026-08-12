-- Rollback for 20260813120000_fix_resolve_reschedule_and_revoke_dead_create_reservation.sql.
-- Restores resolve_reschedule() to the broken
-- 20260809190000_audit_remediation_pack.sql version (nonexistent columns,
-- no row lock) and re-grants create_reservation's two overloads back to
-- their pre-fix privilege state. Only use this to revert to a known-broken
-- state, not as a template.

CREATE OR REPLACE FUNCTION public.resolve_reschedule(
  _reservation_id uuid,
  _approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_res record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can resolve a reschedule request.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending reschedule request for this reservation.';
  END IF;

  IF _approve THEN
    PERFORM public.assert_bookable_slot(
      v_res.reschedule_proposed_date,
      v_res.reschedule_proposed_time,
      _reservation_id
    );

    UPDATE public.reservations
    SET date = v_res.reschedule_proposed_date,
        appointment_time = v_res.reschedule_proposed_time,
        reschedule_status = 'approved',
        reschedule_requested_at = NULL,
        reschedule_proposed_date = NULL,
        reschedule_proposed_time = NULL
    WHERE id = _reservation_id;
  ELSE
    UPDATE public.reservations
    SET reschedule_status = 'declined',
        reschedule_requested_at = NULL,
        reschedule_proposed_date = NULL,
        reschedule_proposed_time = NULL
    WHERE id = _reservation_id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', _reservation_id,
    'approved', _approve
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_reschedule(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_reschedule(uuid, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_reservation(uuid,text,text,integer,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid,text,text,date,timestamptz,text,text,integer) TO PUBLIC;
