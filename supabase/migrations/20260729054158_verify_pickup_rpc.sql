-- Migration: verify_pickup RPC
--
-- Staff-side handoff confirmation. Scans the QR code on a customer's pickup
-- pass (app/reservations/[id].tsx), which encodes reservations.pickup_token,
-- and marks the reservation Completed. Intended caller is the admin
-- dashboard, but the function lives here since this repo owns the shared
-- migration ledger.
--
-- SECURITY DEFINER: no owner/staff RLS policy lets one user flip another
-- customer's reservation status, so this needs to run with elevated rights.
-- is_staff_or_admin() (not is_admin_or_owner()) so any front-of-house staff
-- can complete a handoff, not just admins/owners.
--
-- APPLIED 2026-07-29 as 20260729054158. The admin-dashboard scanning UI does
-- not exist yet, so nothing calls this function in production: it is inert
-- until that flow is built. The admin-dashboard developer still needs to be
-- told it exists.

CREATE OR REPLACE FUNCTION public.verify_pickup(_pickup_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.reservations%rowtype;
  v_status text;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Staff access required.';
  END IF;

  IF _pickup_token IS NULL THEN
    RAISE EXCEPTION 'A pickup token is required.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE pickup_token = _pickup_token
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pickup pass not recognized.';
  END IF;

  v_status := lower(COALESCE(v_reservation.status, 'pending'));
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'This reservation was already picked up.';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed reservations can be picked up.';
  END IF;

  UPDATE public.reservations
  SET status = 'Completed',
      updated_at = now()
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_pickup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_pickup(uuid) TO authenticated;
