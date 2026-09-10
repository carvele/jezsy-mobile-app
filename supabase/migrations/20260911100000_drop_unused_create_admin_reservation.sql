-- create_admin_reservation (20260910230000_pos_v1_writer_audit_discriminators.sql)
-- has never been called from any application code in either the mobile app or
-- admin-dashboard -- staff-created reservations go through the same
-- create_reservation_multi path as customer self-service ones, landing at
-- status 'To Pay', not 'Pending'. Confirmed via a repo-wide search of both
-- codebases and the live reservations table (zero rows with
-- sales_channel = 'admin_assisted' or status = 'Pending'). Dropping it does
-- not touch the 'Pending' status value itself, which is still live in
-- admin-dashboard UI (sidebar badge, status badge, primary-action routing).

DROP FUNCTION IF EXISTS public.create_admin_reservation(uuid, uuid, text, text, timestamp with time zone, text);
