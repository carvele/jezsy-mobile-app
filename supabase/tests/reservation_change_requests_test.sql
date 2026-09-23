-- Integration test for 20260924020000_reservation_change_request_architecture.
-- Run AFTER the migration inside one transaction; the final RAISE always rolls
-- everything back and reports results in the error message.
-- Fixture clock: Thu 2026-09-24 ~01:30 Asia/Manila; store open Mon-Fri 10:00-17:00, 1 per slot.

CREATE FUNCTION pg_temp.act(_uid uuid) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
$f$;

CREATE FUNCTION pg_temp.expect_err(_sql text, _needle text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN 'FAIL (no error)';
EXCEPTION WHEN others THEN
  IF position(lower(_needle) IN lower(SQLERRM || ' ' || SQLSTATE)) > 0 THEN RETURN 'PASS'; END IF;
  RETURN 'FAIL (' || SQLSTATE || ': ' || SQLERRM || ')';
END;
$f$;

CREATE FUNCTION pg_temp.expect_ok(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN 'PASS';
EXCEPTION WHEN others THEN
  RETURN 'FAIL (' || SQLSTATE || ': ' || SQLERRM || ')';
END;
$f$;

CREATE FUNCTION pg_temp.chk(_cond boolean) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'PASS' ELSE 'FAIL' END;
$f$;

DO $t$
DECLARE
  C uuid := '10ea7998-557b-4670-a602-b33d689eab4e';
  OWNR uuid := 'f846e33c-d453-4f59-a750-f7d55462249d';
  INV uuid := '81309c48-125d-4775-a059-f2f2aae037f4';
  PROD uuid := 'b0000008-0000-4000-8000-000000000001';
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid;
  req uuid; v jsonb; v_avail_before int; v_avail int; v_row public.reservations%rowtype;
  outp text := '';
BEGIN
  -- Fixtures (inserted as the migration owner; triggers still run).
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    date, appointment_time, status, payment_status, payment_type, payment_due_at, countdown)
  VALUES ('TST-R1', C, 'Test', PROD, 'Test item', 200, 100, '2026-09-24 16:00Z', '2026-09-25 10:00 Asia/Manila',
    'To Pay', 'Pending', 'Deposit', now() + interval '1 hour', true) RETURNING id INTO r1;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    date, appointment_time, status, payment_status, payment_type, payment_due_at, countdown)
  VALUES ('TST-R2', C, 'Test', PROD, 'Test item', 200, 100, '2026-09-24 16:00Z', '2026-09-25 11:00 Asia/Manila',
    'To Pay', 'Pending', 'Deposit', now() + interval '1 hour', true) RETURNING id INTO r2;
  -- Manila-midnight date convention; old date::date logic filed this under Sep 24 (UTC).
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    date, appointment_time, status, payment_status, payment_type, payment_due_at, countdown)
  VALUES ('TST-R3', C, 'Test', PROD, 'Test item', 200, 100, '2026-09-24 16:00Z', '2026-09-25 12:00 Asia/Manila',
    'To Pay', 'Pending', 'Deposit', now() + interval '1 hour', true) RETURNING id INTO r3;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    date, appointment_time, status, payment_status, payment_type, countdown)
  VALUES ('TST-R4', C, 'Test', PROD, 'Test item', 200, 200, '2026-09-24 16:00Z', '2026-09-25 13:00 Asia/Manila',
    'Preparing', 'Paid', 'Full', false) RETURNING id INTO r4;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    status, payment_status, payment_type, payment_due_at, countdown, pickup_terms_version, pickup_terms_accepted_at)
  VALUES ('TST-R5', C, 'Test', PROD, 'Test item', 200, 100, 'To Pay', 'Pending', 'Deposit', now() + interval '1 hour', true,
    'v2026-09-pickup', now()) RETURNING id INTO r5;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    date, appointment_time, status, payment_status, payment_type, countdown, pickup_ready_at, pickup_deadline_at, balance_settled_at)
  VALUES ('TST-R6', C, 'Test', PROD, 'Test item', 200, 200, '2026-09-24 16:00Z', '2026-09-25 15:00 Asia/Manila',
    'Ready', 'Paid', 'Full', false, now(), now() + interval '3 days', now()) RETURNING id INTO r6;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    status, payment_status, payment_type, countdown, pickup_ready_at, pickup_deadline_at, pickup_terms_version, pickup_terms_accepted_at)
  VALUES ('TST-R7', C, 'Test', PROD, 'Test item', 200, 100, 'To Pay', 'Pending', 'Deposit', false, NULL, NULL,
    'v2026-09-pickup', now()) RETURNING id INTO r7;
  INSERT INTO public.reservation_items (reservation_id, product_id, product_name, size, color, quantity, unit_price, inventory_id)
  SELECT r7, PROD, 'Test item', i.size, i.color, 1, 200, INV FROM public.inventory i WHERE i.id = INV;
  INSERT INTO public.payments (user_id, reservation_id, amount_centavos, status, purpose)
  VALUES (C, r7, 10000, 'paid', 'initial_deposit');
  UPDATE public.reservations SET payment_status = 'Paid' WHERE id = r7;
  UPDATE public.reservations SET status = 'Preparing' WHERE id = r7;
  UPDATE public.reservations SET status = 'Ready', pickup_ready_at = now(), pickup_deadline_at = now() + interval '3 days' WHERE id = r7;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    status, payment_status, payment_type, countdown, pickup_ready_at, pickup_deadline_at)
  VALUES ('TST-R8', C, 'Test', PROD, 'Test item', 200, 100, 'Ready', 'Paid', 'Deposit', false, now(), now() + interval '3 days')
  RETURNING id INTO r8;
  INSERT INTO public.reservations (display_id, customer_id, customer_name, product_id, product_name, rental_price, deposit,
    status, payment_status, payment_type, countdown, pickup_ready_at, pickup_deadline_at, pickup_terms_version, pickup_terms_accepted_at)
  VALUES ('TST-R9', C, 'Test', PROD, 'Test item', 200, 100, 'Ready', 'Paid', 'Deposit', false, now(), now() + interval '3 days',
    'v2026-09-pickup', now()) RETURNING id INTO r9;
  INSERT INTO public.payments (user_id, reservation_id, amount_centavos, status, purpose)
  VALUES (C, r9, 10000, 'paid', 'initial_deposit');
  INSERT INTO public.store_closures (closure_date, is_fully_closed, reason) VALUES ('2026-09-28', true, 'Test closure')
  ON CONFLICT DO NOTHING;

  PERFORM pg_temp.act(C);
  outp := outp || E'\n01 past date: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-23', '10:00', 'x'), 'past');
  outp := outp || E'\n01b manager past date: ' || (SELECT pg_temp.expect_err(format('SELECT set_config(''request.jwt.claims'', %L, true), public.reschedule_reservation_as_manager(%L,%L,%L,%L,%L)',
        json_build_object('sub', OWNR, 'role', 'authenticated')::text, r1, 'To Pay', '2026-09-23', '10:00', 'x'), 'past'));
  PERFORM pg_temp.act(C);
  outp := outp || E'\n01c no date/deadline mutation: ' || pg_temp.chk((SELECT appointment_time = '2026-09-25 10:00 Asia/Manila' AND payment_due_at > now() FROM public.reservations WHERE id = r1));
  outp := outp || E'\n02 same-day past time: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, today, '01:00', 'x'), 'past');
  outp := outp || E'\n04 closed weekday: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-26', '10:00', 'x'), 'closed');
  outp := outp || E'\n05 store closure: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-28', '10:00', 'x'), 'closed on this date');
  outp := outp || E'\n06 outside hours: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '09:00', 'x'), 'outside');
  outp := outp || E'\n07a 10:15 boundary: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '10:15', 'x'), '30-minute');
  outp := outp || E'\n07b 10:30 eligible: ' || pg_temp.expect_ok(format('SELECT public.assert_bookable_slot(%L::date, %L::timestamptz, NULL, true)', '2026-09-25', '2026-09-25 10:30 Asia/Manila'));
  outp := outp || E'\n08 full slot: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '11:00', 'x'), 'fully booked');
  outp := outp || E'\n09 Manila midnight capacity: ' || pg_temp.chk(
        EXISTS (SELECT 1 FROM public.get_slot_booked_counts('2026-09-25') WHERE slot_time = '12:00' AND booked_count >= 1)
        AND NOT EXISTS (SELECT 1 FROM public.get_slot_booked_counts('2026-09-24') WHERE slot_time = '12:00'));
  outp := outp || E'\n10a no reason: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '14:00', '   '), 'why');
  outp := outp || E'\n03/10b valid request: ' || pg_temp.expect_ok(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '14:00', '  I have an exam  '));
  SELECT id INTO req FROM public.reservation_change_requests WHERE reservation_id = r1 AND status = 'pending';
  outp := outp || E'\n10c reason trimmed, appointment unchanged: ' || pg_temp.chk(
        (SELECT reason = 'I have an exam' FROM public.reservation_change_requests WHERE id = req)
        AND (SELECT appointment_time = '2026-09-25 10:00 Asia/Manila' FROM public.reservations WHERE id = r1));
  outp := outp || E'\n10d second pending rejected: ' || pg_temp.expect_err(format('SELECT public.request_ready_cancellation(%L,%L)', r1, 'x'), 'ready');
  outp := outp || E'\n10e duplicate reschedule rejected: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r1, '2026-09-25', '15:30', 'again'), 'already');
  outp := outp || E'\n11 no-appointment reservation: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r5, '2026-09-25', '15:30', 'x'), 'does not have a scheduled appointment');
  outp := outp || E'\n12 ready reschedule: ' || pg_temp.expect_err(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r6, '2026-09-25', '15:30', 'x'), 'no longer be rescheduled');
  outp := outp || E'\n13 ready extension: ' || pg_temp.expect_ok(format('SELECT public.request_pickup_extension(%L,%L)', r6, 'sick'));
  outp := outp || E'\n14a request on Preparing: ' || pg_temp.expect_ok(format('SELECT public.request_reschedule_v2(%L,%L,%L,%L)', r4, '2026-09-25', '16:00', 'work'));

  PERFORM pg_temp.act(OWNR);
  outp := outp || E'\n14b Ready blocked by pending request: ' || pg_temp.expect_err(format('SELECT public.transition_reservation_status(%L,%L,%L)', r4, 'Preparing', 'Ready'), 'reviewed first');
  outp := outp || E'\n14c manager reschedule blocked: ' || pg_temp.expect_err(format('SELECT public.reschedule_reservation_as_manager(%L,%L,%L,%L,%L)', r4, 'Preparing', '2026-09-29', '10:00', 'x'), 'reviewed first');
  outp := outp || E'\nN1 approve reschedule: ' || pg_temp.expect_ok(format('SELECT public.resolve_reschedule_request_v2(%L, true, %L)', req, 'See you then'));
  outp := outp || E'\nN2 appointment moved, deadline future, request approved: ' || pg_temp.chk(
        (SELECT appointment_time = '2026-09-25 14:00 Asia/Manila' AND payment_due_at > now()
                AND reschedule_requested_at IS NULL AND (date AT TIME ZONE 'Asia/Manila')::date = '2026-09-25'
         FROM public.reservations WHERE id = r1)
        AND (SELECT status = 'approved' AND resolved_by = OWNR FROM public.reservation_change_requests WHERE id = req));
  outp := outp || E'\nN3 re-resolve rejected: ' || pg_temp.expect_err(format('SELECT public.resolve_reschedule_request_v2(%L, true, NULL)', req), 'already');
  SELECT id INTO req FROM public.reservation_change_requests WHERE reservation_id = r4 AND status = 'pending';
  outp := outp || E'\nN4 decline reschedule: ' || pg_temp.expect_ok(format('SELECT public.resolve_reschedule_request_v2(%L, false, %L)', req, 'Fully booked'));
  outp := outp || E'\nN5 declined leaves appointment: ' || pg_temp.chk(
        (SELECT appointment_time = '2026-09-25 13:00 Asia/Manila' FROM public.reservations WHERE id = r4)
        AND (SELECT status = 'denied' FROM public.reservation_change_requests WHERE id = req));
  outp := outp || E'\nK1 manager reschedule no reason: ' || pg_temp.expect_err(format('SELECT public.reschedule_reservation_as_manager(%L,%L,%L,%L,%L)', r2, 'To Pay', '2026-09-29', '10:00', ' '), 'reason');
  outp := outp || E'\nK2 manager reschedule Ready rejected: ' || pg_temp.expect_err(format('SELECT public.reschedule_reservation_as_manager(%L,%L,%L,%L,%L)', r6, 'Ready', '2026-09-29', '10:00', 'x'), 'pickup extension');
  outp := outp || E'\nK3 manager reschedule ok: ' || pg_temp.expect_ok(format('SELECT public.reschedule_reservation_as_manager(%L,%L,%L,%L,%L)', r2, 'To Pay', '2026-09-29', '10:00', 'Staff shortage'));
  outp := outp || E'\nK4 deadline future + customer notified: ' || pg_temp.chk(
        (SELECT payment_due_at > now() AND appointment_time = '2026-09-29 10:00 Asia/Manila' FROM public.reservations WHERE id = r2)
        AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = C AND title = 'Your pickup appointment was changed' AND body LIKE '%Staff shortage%'));
  outp := outp || E'\n26 stale expected status -> PT409: ' || pg_temp.expect_err(format('SELECT public.transition_reservation_status(%L,%L,%L)', r2, 'Preparing', 'Ready'), 'PT409');

  outp := outp || E'\n16 handover with pending extension: ' || pg_temp.expect_ok(format('SELECT public.complete_reservation_handover(%L,%L)', r6, 'cash'));
  outp := outp || E'\n16b extension closed on collection: ' || pg_temp.chk(
        (SELECT status = 'Completed' AND extension_status = 'closed' AND extension_reason = 'sick'
                AND extension_resolution_notes LIKE '%collected%' FROM public.reservations WHERE id = r6));
  outp := outp || E'\n25 double handover -> one mutation: ' || pg_temp.expect_err(format('SELECT public.complete_reservation_handover(%L,%L)', r6, 'cash'), 'ready for pickup');
  outp := outp || E'\n24 deposit-only handover: ' || pg_temp.expect_err(format('SELECT public.complete_reservation_handover(%L,%L)', r8, 'cash'), 'remaining balance');

  SELECT available INTO v_avail_before FROM public.inventory WHERE id = INV;
  PERFORM pg_temp.act(C);
  outp := outp || E'\nG1 ready cancel no reason: ' || pg_temp.expect_err(format('SELECT public.request_ready_cancellation(%L,%L)', r7, ''), 'why');
  outp := outp || E'\n17 ready cancel request: ' || pg_temp.expect_ok(format('SELECT public.request_ready_cancellation(%L,%L)', r7, 'Cannot collect anymore'));
  outp := outp || E'\n17b no cancel/forfeit/release at request: ' || pg_temp.chk(
        (SELECT status = 'Ready' FROM public.reservations WHERE id = r7)
        AND (SELECT forfeited_centavos IS NULL FROM public.payments WHERE reservation_id = r7)
        AND (SELECT available = v_avail_before FROM public.inventory WHERE id = INV));
  PERFORM pg_temp.act(OWNR);
  outp := outp || E'\n15 handover blocked by pending cancellation: ' || pg_temp.expect_err(format('SELECT public.complete_reservation_handover(%L,%L)', r7, 'cash'), 'reviewed first');
  SELECT id INTO req FROM public.reservation_change_requests WHERE reservation_id = r7 AND status = 'pending';
  outp := outp || E'\n19 decline ready cancel: ' || pg_temp.expect_ok(format('SELECT public.resolve_ready_cancellation_request(%L, false, %L)', req, 'Please collect'));
  outp := outp || E'\n19b stays Ready: ' || pg_temp.chk((SELECT status = 'Ready' FROM public.reservations WHERE id = r7));
  PERFORM pg_temp.act(C);
  outp := outp || E'\n19c re-request allowed: ' || pg_temp.expect_ok(format('SELECT public.request_ready_cancellation(%L,%L)', r7, 'Still cannot collect'));
  SELECT id INTO req FROM public.reservation_change_requests WHERE reservation_id = r7 AND status = 'pending';
  PERFORM pg_temp.act(OWNR);
  outp := outp || E'\n18 approve ready cancel: ' || pg_temp.expect_ok(format('SELECT public.resolve_ready_cancellation_request(%L, true, NULL)', req));
  outp := outp || E'\n18b forfeited once, cancelled, inventory released: ' || pg_temp.chk(
        (SELECT status = 'Cancelled' AND payment_status = 'Cancelled' AND cancellation_reason LIKE '%Still cannot collect%'
         FROM public.reservations WHERE id = r7)
        AND (SELECT sum(forfeited_centavos) = 10000 AND bool_and(NOT requires_refund) FROM public.payments WHERE reservation_id = r7)
        AND (SELECT available = v_avail_before + 1 FROM public.inventory WHERE id = INV)
        AND (SELECT status = 'approved' FROM public.reservation_change_requests WHERE id = req));
  outp := outp || E'\n18c re-approve rejected: ' || pg_temp.expect_err(format('SELECT public.resolve_ready_cancellation_request(%L, true, NULL)', req), 'already');

  outp := outp || E'\n20 admin cancel no reason: ' || pg_temp.expect_err(format('SELECT public.cancel_reservation_as_manager(%L,%L,%L)', r5, 'To Pay', '  '), 'reason');
  outp := outp || E'\n21 admin cancel with reason: ' || pg_temp.expect_ok(format('SELECT public.cancel_reservation_as_manager(%L,%L,%L)', r5, 'To Pay', 'Item damaged during preparation'));
  outp := outp || E'\n21b reason stored + notified + logged: ' || pg_temp.chk(
        (SELECT cancellation_reason = 'Item damaged during preparation' FROM public.reservations WHERE id = r5)
        AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = C AND body LIKE '%Reason: Item damaged during preparation%')
        AND EXISTS (SELECT 1 FROM public.logs WHERE target_id = r5::text AND details->>'reason' = 'Item damaged during preparation'));
  outp := outp || E'\nJ1 stale cancel -> PT409: ' || pg_temp.expect_err(format('SELECT public.cancel_reservation_as_manager(%L,%L,%L)', r3, 'Ready', 'x'), 'PT409');

  -- Q: pickup expiry supersedes a pending ready-cancellation; expiry policy stays authoritative.
  PERFORM pg_temp.act(C);
  outp := outp || E'\nQ1 request on expiring order: ' || pg_temp.expect_ok(format('SELECT public.request_ready_cancellation(%L,%L)', r9, 'Busy'));
  UPDATE public.reservations SET pickup_deadline_at = now() - interval '1 minute' WHERE id = r9;
  PERFORM public.sweep_pickup_deadlines();
  outp := outp || E'\nQ2 expiry wins, request superseded: ' || pg_temp.chk(
        (SELECT status = 'Cancelled' AND cancellation_reason = 'Pickup deadline expired' FROM public.reservations WHERE id = r9)
        AND (SELECT status = 'superseded' AND resolution_notes LIKE '%pickup deadline expired%'
             FROM public.reservation_change_requests WHERE reservation_id = r9));

  outp := outp || E'\n22 no terminal pending extensions: ' || pg_temp.chk(NOT EXISTS (
        SELECT 1 FROM public.reservations WHERE extension_status = 'pending'
        AND lower(status) IN ('completed', 'cancelled', 'unclaimed')));
  outp := outp || E'\nRLS customer cannot insert: ' || pg_temp.chk(NOT has_table_privilege('authenticated', 'public.reservation_change_requests', 'INSERT'));
  outp := outp || E'\nhelpers not client-callable: ' || pg_temp.chk(NOT has_function_privilege('authenticated', 'public.has_pending_blocking_reservation_change(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.request_reschedule_v2(uuid,date,time,text)', 'EXECUTE'));

  RAISE EXCEPTION 'DRYRUN_RESULTS:%', outp;
END;
$t$;
