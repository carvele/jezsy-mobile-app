-- Fixes resolve_reschedule(), broken by 20260809190000_audit_remediation_pack.sql's
-- rewrite: it referenced reschedule_proposed_date, reschedule_proposed_time,
-- and reschedule_status, none of which exist on public.reservations. The
-- real columns (also what the mobile app itself reads, see
-- app/reservations/[id].tsx) are reschedule_requested_date and
-- reschedule_requested_at_time; there is no separate status column --
-- "resolved" is inferred from reschedule_requested_at being NULL. Every
-- call to this RPC (approve or decline) has been failing at runtime since
-- that migration applied -- staff could not resolve a single pending
-- reschedule request.
--
-- Also restores the FOR UPDATE row lock the original
-- (20260807145303_reschedule_request_rpcs.sql) had, which the same rewrite
-- silently dropped -- same class of regression as settle_reservation_balance
-- fixed in 20260812120000/20260812130000.
--
-- Keeps the one real improvement that rewrite made: is_staff_or_admin()
-- instead of a raw role lookup (audit finding F13).
--
-- Verified fixed via a rolled-back live test: insert a reservation with a
-- pending reschedule request, impersonate a staff actor, call the RPC with
-- _approve = true, confirm date/appointment_time update to the requested
-- values and all reschedule_requested_* columns clear, then ROLLBACK.
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
  v_res public.reservations%rowtype;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Only staff or administrators can resolve a reschedule request.';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = _reservation_id AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found or deleted.';
  END IF;

  IF v_res.reschedule_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending reschedule request for this reservation.';
  END IF;

  IF _approve THEN
    -- The slot was free when it was asked for; it may not be now. Re-checking
    -- here is what stops an approval double-booking a slot that filled while
    -- the request sat in the queue. The row trigger re-checks again on write.
    PERFORM public.assert_bookable_slot(
      v_res.reschedule_requested_date,
      v_res.reschedule_requested_at_time,
      _reservation_id
    );

    UPDATE public.reservations
    SET date                         = v_res.reschedule_requested_date,
        appointment_time             = v_res.reschedule_requested_at_time,
        reschedule_requested_date    = NULL,
        reschedule_requested_at_time = NULL,
        reschedule_requested_at      = NULL
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
  ELSE
    UPDATE public.reservations
    SET reschedule_requested_date    = NULL,
        reschedule_requested_at_time = NULL,
        reschedule_requested_at      = NULL
    WHERE id = _reservation_id
    RETURNING * INTO v_res;
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

-- Revokes the two create_reservation overloads: confirmed via repo search
-- unused by either app (superseded by create_reservation_multi), and both
-- are broken if ever called -- this one selects profiles.full_name (does
-- not exist, same bug class as settle_reservation_balance) and inserts into
-- public.reservation_seq (does not exist at all). The
-- (date,timestamptz,...) overload additionally has a signature
-- CREATE OR REPLACE never matched before, so it silently inherited
-- PostgreSQL's default PUBLIC execute grant and was callable by anon
-- directly via PostgREST (fails closed on the auth.uid() check, so not
-- exploitable, but the same excess-privilege pattern already remediated
-- once for a different RPC in 20260719121500_revoke_unused_reservation_rpc.sql).
REVOKE ALL ON FUNCTION public.create_reservation(uuid,text,text,integer,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_reservation(uuid,text,text,date,timestamptz,text,text,integer) FROM PUBLIC, anon, authenticated;
