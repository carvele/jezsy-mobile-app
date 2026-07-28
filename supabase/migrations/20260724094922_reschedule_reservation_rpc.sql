-- Migration: reschedule_reservation RPC
--
-- Lets a customer move the date/appointment_time of their own reservation
-- while it is still Pending or Confirmed. The existing
-- trg_validate_reservation_time trigger (BEFORE INSERT OR UPDATE OF date,
-- appointment_time) re-checks operating hours and the 3-per-slot capacity, so
-- availability stays enforced server-side even for updates. Routing through
-- this function (rather than a broad owner UPDATE via RLS) limits the writable
-- columns to date and appointment_time and enforces the status guard.
--
-- SECURITY INVOKER: the owner RLS policy on reservations already permits the
-- customer to update their own row, so no elevated privilege is needed.

CREATE OR REPLACE FUNCTION public.reschedule_reservation(
  _reservation_id uuid,
  _date text,
  _appointment_time text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _date IS NULL OR _date = '' OR _appointment_time IS NULL OR _appointment_time = '' THEN
    RAISE EXCEPTION 'A new date and appointment time are required.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = _reservation_id
    AND customer_id = v_user_id
    AND COALESCE(deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_status := lower(COALESCE(v_reservation.status, 'pending'));
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Only pending or confirmed reservations can be rescheduled.';
  END IF;

  -- trg_validate_reservation_time enforces operating hours + slot capacity here.
  UPDATE public.reservations
  SET date = _date::date,
      appointment_time = _appointment_time::time
  WHERE id = _reservation_id
  RETURNING * INTO v_reservation;

  RETURN to_jsonb(v_reservation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) TO authenticated;
