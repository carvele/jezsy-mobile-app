-- =================================================================================
-- e2e_test.sql -- Rev 3 Final (Execution-Ready)
-- Pickup & Extension Lifecycle E2E Verification Matrix
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- ENVIRONMENT SPLIT
--
-- ISOLATED BRANCH / LOCAL / STAGING ONLY:
--   Run the BEGIN...ROLLBACK block below.
--   sweep_pickup_deadlines() is called directly. Any real expired Ready
--   reservation with pickup_terms_accepted_at IS NOT NULL would be processed.
--   Do NOT run the destructive suite against the shared production database.
--
-- SHARED PRODUCTION DB SAFE:
--   Scroll to "SHARED-DB SAFE: Pre-cron Candidate Report" at the bottom.
--   That section is a SELECT-only, mirrors the exact sweep predicate, and
--   contains no RPCs or mutations.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- EXPECTED FAILURES BEFORE 140105 IS APPLIED (all resolved by 140105)
-- ===========================================================================
-- GAP-1  cancel_no_show_reservation() has no fully-paid guard.
--        Case 7A FAILS until 140105 is applied.
-- GAP-2  cancel_no_show_reservation() and cancel_reservation_after_ready() emit
--        'Refund Required' for amounts above deposit on customer-fault paths.
--        Cases 4b, 6 FAIL until 140105 is applied.
-- GAP-3  create_reservation_multi() accepts NULL terms on the new NULL-date workflow.
--        Case 13a FAILS until 140105 is applied.
-- ===========================================================================
-- After 140105 is applied, ALL cases in the suite are expected to PASS.
-- ===========================================================================
-- ---------------------------------------------------------------------------
--
-- HOW TO READ OUTPUT
-- Notices ending ": PASSED"  => assertion satisfied
-- EXCEPTION                  => case failed; message states which case and why
-- =================================================================================

-- =================================================================================
-- ISOLATED SUITE
-- =================================================================================
BEGIN;

DO $$
DECLARE
  -- Synthetic identity
  v_customer_id    uuid := gen_random_uuid();
  v_staff_id       uuid := gen_random_uuid();

  -- Product fixture
  v_product_id     uuid := gen_random_uuid();
  v_product_price  numeric := 5000.00;   -- PHP 5,000 rental price
  v_initial_stock  integer := 30;

  -- Snapshotted values read from the reservation row after RPC creation
  v_snapped_rental numeric;
  v_snapped_deposit numeric;

  -- Reservation handles (one per isolated case)
  v_res_terms_null uuid;   -- 13a: NULL terms on new workflow
  v_res_terms_test uuid;   -- 13b: bogus terms canonicalization
  v_res_phase2     uuid;   -- 1a: phase-2 NULL-date payload
  v_res_legacy     uuid;   -- 1b: legacy both-present; case 9 reuses this
  v_res_ready      uuid;   -- 2/3a/3b/3c: Ready + denial path
  v_res_ext_appr   uuid;   -- 3d: extension approval (separate reservation)
  v_res_dep_exp    uuid;   -- 4: deposit expiry -> Cancelled/Cancelled
  v_res_dep_vol    uuid;   -- 5: deposit voluntary cancel (BD-7)
  v_res_full_vol   uuid;   -- 6: fully-paid voluntary cancel (policy: Cancelled/Cancelled)
  v_res_full_exp   uuid;   -- 7: fully-paid expiry -> Unclaimed/Paid
  v_res_idempotent uuid;   -- 11: idempotency sweep test

  -- Closed-day extension fixture (case 3d)
  v_monday_close   time;
  v_deadline_sat   timestamptz;
  v_expected_dl    timestamptz;
  v_deadline_after timestamptz;

  -- Working vars
  v_result         jsonb;
  v_canonical      text;
  v_stock_before   integer;
  v_stock_after    integer;
  v_dedup_before   integer;
  v_dedup_after    integer;
BEGIN
  RAISE NOTICE '==========================================================';
  RAISE NOTICE 'E2E Pickup & Extension Lifecycle -- Rev 3 Final';
  RAISE NOTICE '==========================================================';


  -- -----------------------------------------------------------------------
  -- 0. FIXTURE SETUP
  -- -----------------------------------------------------------------------

  -- === CONTEXT: superuser / no JWT needed for direct INSERT ===

  -- Synthetic auth users (minimal columns required by Supabase auth schema)
  INSERT INTO auth.users (
    id, email, encrypted_password, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) VALUES
    (v_customer_id, 'e2e-customer@jezsy-test.invalid', 'x', now(), now(),
     '{"provider":"email"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_staff_id,    'e2e-staff@jezsy-test.invalid',    'x', now(), now(),
     '{"provider":"email"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated');

  INSERT INTO public.profiles (id, first_name, last_name, role, is_blocked, deleted)
  VALUES
    (v_customer_id, 'E2E', 'Customer', 'customer', false, false),
    (v_staff_id,    'E2E', 'Staff',    'admin',    false, false);

  -- Product: status must be 'active' (lowercase) -- create_reservation_multi checks this literally
  INSERT INTO public.products (id, name, price, stock, status, deleted)
  VALUES (v_product_id, 'E2E Test Gown', v_product_price, v_initial_stock, 'active', false);

  -- Transaction-scoped deterministic store_hours for case 3d.
  -- Within this rollback transaction any mutation here is safe and will be undone.
  -- Known live values: Sunday(0) closed, Saturday(6) closed, Monday(1) open 17:00.
  -- We assert these explicitly so the test is not dependent on whatever a branch has.
  UPDATE public.store_hours SET is_closed = true              WHERE day_of_week IN (0, 6);
  UPDATE public.store_hours SET is_closed = false, close_time = '17:00' WHERE day_of_week = 1;
  SELECT close_time INTO v_monday_close FROM public.store_hours WHERE day_of_week = 1;

  RAISE NOTICE '0. Fixtures ready. store_hours[Sun]=closed, store_hours[Sat]=closed, store_hours[Mon]=open at %.', v_monday_close;


  -- -----------------------------------------------------------------------
  -- 13a. NULL terms on new (NULL-date) workflow must be REJECTED
  --      A client omitting _pickup_terms_version with NULL dates would create a
  --      reservation permanently excluded from the automatic deadline policy.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.create_reservation_multi_idempotent(
      _idempotency_key      := gen_random_uuid(),
      _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
      _payment_option       := 'deposit',
      _customer_id          := v_customer_id,
      _date                 := NULL,
      _appointment_time     := NULL,
      _pickup_terms_version := NULL
    );
    RAISE EXCEPTION '13a FAILED: NULL-date + NULL-time + NULL-terms accepted. '
      'Client can bypass pickup_terms_accepted_at and become permanently grandfathered.';
  EXCEPTION
    WHEN check_violation    THEN RAISE NOTICE '13a. NULL-date + NULL-time + NULL-terms rejected (check_violation): PASSED';
    WHEN raise_exception    THEN RAISE;   -- re-raise our own sentinel
    WHEN OTHERS             THEN RAISE NOTICE '13a. NULL terms rejected with %: PASSED', SQLERRM;
  END;


  -- -----------------------------------------------------------------------
  -- 13b. Bogus non-null terms version must be overwritten with canonical
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT (unchanged) ===
  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'bogus-client-v999'
  );
  v_res_terms_test := (v_result->>'id')::uuid;

  SELECT pickup_terms_version INTO v_canonical
  FROM public.reservations WHERE id = v_res_terms_test;

  IF v_canonical <> 'v2026-09-pickup' THEN
    RAISE EXCEPTION '13b FAILED: Bogus client version "%" was persisted instead of canonical.', v_canonical;
  END IF;
  RAISE NOTICE '13b. Bogus client version overwritten with canonical "%": PASSED', v_canonical;


  -- -----------------------------------------------------------------------
  -- 1a. PHASE-2 PAYLOAD: date=NULL, appointment_time=NULL, valid terms
  --     Also asserts that the RPC correctly snapshots rental_price and deposit.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT (unchanged) ===
  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _date                 := NULL,
    _appointment_time     := NULL,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_phase2 := (v_result->>'id')::uuid;

  -- Assert RPC snapshot (do not manually overwrite)
  SELECT rental_price, deposit INTO v_snapped_rental, v_snapped_deposit
  FROM public.reservations WHERE id = v_res_phase2;

  IF v_snapped_rental <> v_product_price THEN
    RAISE EXCEPTION '1a FAILED: rental_price snapshot is % expected %.', v_snapped_rental, v_product_price;
  END IF;
  IF v_snapped_deposit <> round(v_product_price * 0.5, 2) THEN
    RAISE EXCEPTION '1a FAILED: deposit snapshot is % expected 50%% of % = %.', 
      v_snapped_deposit, v_product_price, round(v_product_price * 0.5, 2);
  END IF;
  RAISE NOTICE '1a. Phase-2 NULL-date accepted; rental_price=% deposit=% snapshotted correctly: PASSED',
    v_snapped_rental, v_snapped_deposit;


  -- -----------------------------------------------------------------------
  -- 1b. LEGACY PAYLOAD: both date and appointment_time present
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT (unchanged) ===
  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _date                 := (now() + interval '3 days')::date::text,
    _appointment_time     := '14:00',
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_legacy := (v_result->>'id')::uuid;
  RAISE NOTICE '1b. Legacy both-present payload accepted: PASSED';


  -- -----------------------------------------------------------------------
  -- 1c. HALF-NULL PAYLOAD must be rejected
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT (unchanged) ===
  BEGIN
    PERFORM public.create_reservation_multi_idempotent(
      _idempotency_key      := gen_random_uuid(),
      _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
      _payment_option       := 'deposit',
      _customer_id          := v_customer_id,
      _date                 := (now() + interval '3 days')::date::text,
      _appointment_time     := NULL
    );
    RAISE EXCEPTION '1c FAILED: Half-null (date present, time absent) was accepted.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '1c. Half-null payload rejected: PASSED';
  END;


  -- Inventory: 3 reservations created (13b, 1a, 1b) = 3 units held
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_initial_stock - 3 THEN
    RAISE EXCEPTION '1d FAILED: Inventory after creation is % expected %.', v_stock_after, v_initial_stock - 3;
  END IF;
  RAISE NOTICE '1d. Inventory held correctly (stock=% after 3 creations): PASSED', v_stock_after;


  -- -----------------------------------------------------------------------
  -- 2. READY TRANSITION via transition_reservation_status()
  --    Production path that writes pickup_ready_at + pickup_deadline_at.
  --    Creates two reservations: v_res_ready (denial path) and v_res_ext_appr (approval path).
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT for creation ===
  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_ready := (v_result->>'id')::uuid;

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_ext_appr := (v_result->>'id')::uuid;

  -- === CONTEXT: staff JWT for status transitions ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  -- Advance both: To Pay -> Preparing requires payment_status='Paid'
  UPDATE public.reservations SET payment_status = 'Paid' WHERE id IN (v_res_ready, v_res_ext_appr);
  PERFORM public.transition_reservation_status(v_res_ready,    'To Pay', 'Preparing');
  PERFORM public.transition_reservation_status(v_res_ext_appr, 'To Pay', 'Preparing');
  PERFORM public.transition_reservation_status(v_res_ready,    'Preparing', 'Ready');
  PERFORM public.transition_reservation_status(v_res_ext_appr, 'Preparing', 'Ready');

  -- Assert deadline written by the production RPC, not by a direct UPDATE
  IF (SELECT pickup_deadline_at FROM public.reservations WHERE id = v_res_ready) IS NULL THEN
    RAISE EXCEPTION '2 FAILED: pickup_deadline_at is NULL after transition to Ready.';
  END IF;
  IF (SELECT pickup_deadline_at FROM public.reservations WHERE id = v_res_ready) <= now() THEN
    RAISE EXCEPTION '2 FAILED: pickup_deadline_at is not in the future.';
  END IF;
  RAISE NOTICE '2. Transition Preparing->Ready sets pickup_deadline_at in the future: PASSED';


  -- -----------------------------------------------------------------------
  -- 3a. EXTENSION: reason is required (null and blank both rejected)
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.request_pickup_extension(v_res_ready, NULL, NULL);
    RAISE EXCEPTION '3a FAILED: NULL reason accepted.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '3a. NULL reason rejected: PASSED';
  END;

  BEGIN
    PERFORM public.request_pickup_extension(v_res_ready, '   ', NULL);
    RAISE EXCEPTION '3a-blank FAILED: blank reason accepted.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '3a-blank. Blank reason rejected: PASSED';
  END;


  -- -----------------------------------------------------------------------
  -- 3b. PENDING EXTENSION BLOCKS EXPIRY
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT (unchanged) ===
  PERFORM public.request_pickup_extension(v_res_ready, 'Travelling for work', NULL);

  -- Force deadline into the past to trigger expiry condition
  UPDATE public.reservations
  SET pickup_deadline_at = now() - interval '2 hours'
  WHERE id = v_res_ready;

  BEGIN
    PERFORM public.cancel_no_show_reservation(v_res_ready);
    RAISE EXCEPTION '3b FAILED: Pending extension did not block cancel_no_show_reservation().';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '3b. Pending extension blocks expiry: PASSED';
  END;


  -- -----------------------------------------------------------------------
  -- 3c. EXTENSION DENIAL + ONE-REQUEST INVARIANT
  --     Staff denies. Deadline must not move. extension_status=denied.
  --     A second request must be permanently blocked.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: staff JWT for resolve ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  PERFORM public.resolve_pickup_extension(v_res_ready, false, 'Cannot accommodate');

  IF (SELECT pickup_deadline_at FROM public.reservations WHERE id = v_res_ready) >= now() THEN
    RAISE EXCEPTION '3c FAILED: Deadline moved forward on denial.';
  END IF;
  IF (SELECT extension_status FROM public.reservations WHERE id = v_res_ready) <> 'denied' THEN
    RAISE EXCEPTION '3c FAILED: extension_status is not denied.';
  END IF;
  RAISE NOTICE '3c. Denial preserves expired deadline and sets extension_status=denied: PASSED';

  -- Verify one-request invariant: second request must fail even after denial
  -- (Restore deadline to future so the deadline-passed guard is not the first one to fire)
  UPDATE public.reservations SET pickup_deadline_at = now() + interval '1 day' WHERE id = v_res_ready;

  -- === CONTEXT: customer JWT for second request ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.request_pickup_extension(v_res_ready, 'Trying again after denial', NULL);
    RAISE EXCEPTION '3c-oneshot FAILED: Second request accepted after denial.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '3c-oneshot. One-request invariant enforced after denial: PASSED';
  END;


  -- -----------------------------------------------------------------------
  -- 3d. EXTENSION APPROVAL -- DETERMINISTIC CLOSED-DAY CALCULATION
  --     Live store_hours (confirmed): Sun(0)=closed, Sat(6)=closed, Mon(1)=open 17:00.
  --     Transaction-scoped UPDATE at top of block ensures this is deterministic
  --     on any branch regardless of its own configuration.
  --
  --     Scenario:
  --       Deadline = next Saturday at 12:00 Manila (future, so request is valid)
  --       compute_extension_deadline advances 1 open day:
  --         Saturday: closed -> skip
  --         Sunday:   closed -> skip
  --         Monday:   open, close_time=17:00 -> count 1 -> done
  --       Expected new deadline = Monday at 17:00 Manila (exact match)
  -- -----------------------------------------------------------------------

  -- next Saturday = date_trunc('week', today Manila) + 12 days + 12h
  --   date_trunc('week') = most recent ISO Monday
  --   +5 days = this Saturday; +12 days = next Saturday
  v_deadline_sat :=
    (date_trunc('week', now() AT TIME ZONE 'Asia/Manila')::date
     + 12 + interval '12 hours')
    AT TIME ZONE 'Asia/Manila';

  -- Expected: Monday after that Saturday at close_time (17:00)
  --   next Monday = date_trunc('week') + 14 days
  v_expected_dl :=
    (date_trunc('week', now() AT TIME ZONE 'Asia/Manila')::date
     + 14 + v_monday_close)
    AT TIME ZONE 'Asia/Manila';

  -- Independently verify via the production function (belt-and-suspenders)
  DECLARE v_fn_dl timestamptz;
  BEGIN
    SELECT public.compute_extension_deadline(v_deadline_sat) INTO v_fn_dl;
    IF v_fn_dl <> v_expected_dl THEN
      RAISE EXCEPTION '3d SETUP: compute_extension_deadline(%) returned % but manual calculation gives %. Check store_hours fixture.',
        v_deadline_sat, v_fn_dl, v_expected_dl;
    END IF;
  END;

  UPDATE public.reservations SET pickup_deadline_at = v_deadline_sat WHERE id = v_res_ext_appr;

  -- === CONTEXT: customer JWT for extension request ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  PERFORM public.request_pickup_extension(v_res_ext_appr, 'Out of town until Sunday', NULL);

  -- === CONTEXT: staff JWT for approval ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  PERFORM public.resolve_pickup_extension(v_res_ext_appr, true, 'Approved');

  SELECT pickup_deadline_at INTO v_deadline_after FROM public.reservations WHERE id = v_res_ext_appr;

  IF v_deadline_after <> v_expected_dl THEN
    RAISE EXCEPTION '3d FAILED: Approval set deadline to % but expected % (next Monday % close_time).',
      v_deadline_after, v_expected_dl, v_monday_close;
  END IF;
  IF extract(dow from v_deadline_after AT TIME ZONE 'Asia/Manila') = 0 THEN
    RAISE EXCEPTION '3d FAILED: Deadline landed on closed Sunday (%).', v_deadline_after;
  END IF;
  RAISE NOTICE '3d. Approval: Saturday->skip Sunday->Monday % = %: PASSED', v_monday_close, v_deadline_after;


  -- -----------------------------------------------------------------------
  -- 4. DEPOSIT-ONLY EXPIRY -> Cancelled / Cancelled
  --    Payment row uses actual snapshotted deposit (no hardcoded literals).
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT for creation ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_dep_exp := (v_result->>'id')::uuid;

  -- Payment row: read actual snapshotted deposit, do not hardcode
  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_dep_exp, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_dep_exp;

  UPDATE public.reservations
  SET status             = 'Ready',
      payment_status     = 'Deposit Paid',
      pickup_ready_at    = now() - interval '5 days',
      pickup_deadline_at = now() - interval '1 hour'
  WHERE id = v_res_dep_exp;

  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;
  -- === CONTEXT: no JWT needed -- cancel_no_show_reservation is SECURITY DEFINER, no caller check ===
  PERFORM public.cancel_no_show_reservation(v_res_dep_exp);

  IF (SELECT status FROM public.reservations WHERE id = v_res_dep_exp) <> 'Cancelled' THEN
    RAISE EXCEPTION '4 FAILED: status is % not Cancelled.', (SELECT status FROM public.reservations WHERE id = v_res_dep_exp);
  END IF;
  -- deposit-only: total_paid = deposit, refundable = 0 -> payment_status = 'Cancelled'
  IF (SELECT payment_status FROM public.reservations WHERE id = v_res_dep_exp) <> 'Cancelled' THEN
    RAISE EXCEPTION '4 FAILED: payment_status is % not Cancelled.',
      (SELECT payment_status FROM public.reservations WHERE id = v_res_dep_exp);
  END IF;
  IF coalesce((SELECT bool_or(coalesce(requires_refund, false)) FROM public.payments
               WHERE reservation_id = v_res_dep_exp), false) THEN
    RAISE EXCEPTION '4 FAILED: requires_refund=true on deposit-only expiry.';
  END IF;
  IF (SELECT coalesce(sum(forfeited_centavos), 0) FROM public.payments WHERE reservation_id = v_res_dep_exp)
      <> (SELECT round(deposit * 100)::bigint FROM public.reservations WHERE id = v_res_dep_exp) THEN
    RAISE EXCEPTION '4 FAILED: Deposit not fully forfeited.';
  END IF;
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before + 1 THEN
    RAISE EXCEPTION '4 FAILED: Inventory not released (before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  RAISE NOTICE '4. Deposit-only expiry -> Cancelled/Cancelled, forfeited, inventory released: PASSED';


  -- -----------------------------------------------------------------------
  -- -----------------------------------------------------------------------
  -- 4b. PARTIAL (75%) PAYMENT EXPIRY -> Cancelled / Cancelled
  --     This is the key policy boundary case: total_paid > deposit but < rental_price.
  --     Pre-140105 behavior: refundable = 75% - 50% = 25% -> Refund Required (WRONG).
  --     Post-140105 policy: forfeit ALL settled payments, no refund.
  --     Tests cancel_no_show_reservation() after hardening.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  DECLARE
    v_res_partial_exp uuid;
    v_partial_paid_cents bigint;
  BEGIN
    v_result := public.create_reservation_multi_idempotent(
      _idempotency_key      := gen_random_uuid(),
      _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
      _payment_option       := 'deposit',
      _customer_id          := v_customer_id,
      _pickup_terms_version := 'v2026-09-pickup'
    );
    v_res_partial_exp := (v_result->>'id')::uuid;

    -- Insert deposit payment (50% of price)
    INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
    SELECT v_res_partial_exp, v_customer_id,
           round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
    FROM public.reservations WHERE id = v_res_partial_exp;

    -- Insert additional partial payment to reach 75% total paid
    -- Extra = 25% of rental_price = 75% - 50% deposit already inserted
    INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
    SELECT v_res_partial_exp, v_customer_id,
           round(rental_price * 100 * 0.25)::bigint, 'paid', 'partial_balance', 'PHP', 'manual'
    FROM public.reservations WHERE id = v_res_partial_exp;

    SELECT coalesce(sum(amount_centavos), 0) INTO v_partial_paid_cents
    FROM public.payments WHERE reservation_id = v_res_partial_exp AND status = 'paid';

    UPDATE public.reservations
    SET status             = 'Ready',
        payment_status     = 'Deposit Paid',
        pickup_ready_at    = now() - interval '5 days',
        pickup_deadline_at = now() - interval '1 hour'
    WHERE id = v_res_partial_exp;

    SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;
    PERFORM public.cancel_no_show_reservation(v_res_partial_exp);

    IF (SELECT status FROM public.reservations WHERE id = v_res_partial_exp) <> 'Cancelled' THEN
      RAISE EXCEPTION '4b FAILED: status is % not Cancelled.', (SELECT status FROM public.reservations WHERE id = v_res_partial_exp);
    END IF;
    -- Policy: no refund even for the amount above deposit (GAP-2 in pre-140105 DB)
    IF (SELECT payment_status FROM public.reservations WHERE id = v_res_partial_exp) <> 'Cancelled' THEN
      RAISE EXCEPTION '4b FAILED (GAP-2): payment_status is "%" not "Cancelled". '
        '140105 hardening required: cancel_no_show_reservation() must forfeit all settled payments '
        'including amounts above the original deposit amount.',
        (SELECT payment_status FROM public.reservations WHERE id = v_res_partial_exp);
    END IF;
    IF coalesce((SELECT bool_or(coalesce(requires_refund, false)) FROM public.payments
                 WHERE reservation_id = v_res_partial_exp), false) THEN
      RAISE EXCEPTION '4b FAILED: requires_refund=true on 75%%-paid expiry.';
    END IF;
    -- All 75% must be forfeited, not just the 50% deposit
    IF (SELECT coalesce(sum(forfeited_centavos), 0) FROM public.payments
        WHERE reservation_id = v_res_partial_exp) <> v_partial_paid_cents THEN
      RAISE EXCEPTION '4b FAILED: forfeited_centavos (%) does not equal total_paid (%).',
        (SELECT coalesce(sum(forfeited_centavos), 0) FROM public.payments WHERE reservation_id = v_res_partial_exp),
        v_partial_paid_cents;
    END IF;
    SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
    IF v_stock_after <> v_stock_before + 1 THEN
      RAISE EXCEPTION '4b FAILED: Inventory not released (before=%, after=%).', v_stock_before, v_stock_after;
    END IF;
    RAISE NOTICE '4b. 75%%-paid expiry -> Cancelled/Cancelled, all % centavos forfeited, released: PASSED', v_partial_paid_cents;
  END;


  -- -----------------------------------------------------------------------
  -- 5. DEPOSIT VOLUNTARY CANCEL BEFORE DEADLINE via cancel_reservation_after_ready()
  --    (BD-7 path). Ready + future deadline. Expected: Cancelled/Cancelled, no refund.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_dep_vol := (v_result->>'id')::uuid;

  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_dep_vol, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_dep_vol;

  UPDATE public.reservations
  SET status             = 'Ready',
      payment_status     = 'Deposit Paid',
      pickup_ready_at    = now() - interval '1 day',
      pickup_deadline_at = now() + interval '2 days'   -- future: voluntary cancel is valid
  WHERE id = v_res_dep_vol;

  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;
  -- === CONTEXT: customer JWT -- cancel_reservation_after_ready checks customer_id = auth.uid() ===
  PERFORM public.cancel_reservation_after_ready(v_res_dep_vol);

  IF (SELECT status FROM public.reservations WHERE id = v_res_dep_vol) <> 'Cancelled' THEN
    RAISE EXCEPTION '5 FAILED: status is % not Cancelled.', (SELECT status FROM public.reservations WHERE id = v_res_dep_vol);
  END IF;
  IF (SELECT payment_status FROM public.reservations WHERE id = v_res_dep_vol) <> 'Cancelled' THEN
    RAISE EXCEPTION '5 FAILED: payment_status is % not Cancelled (deposit-only no refund).',
      (SELECT payment_status FROM public.reservations WHERE id = v_res_dep_vol);
  END IF;
  IF coalesce((SELECT bool_or(coalesce(requires_refund, false)) FROM public.payments
               WHERE reservation_id = v_res_dep_vol), false) THEN
    RAISE EXCEPTION '5 FAILED: requires_refund=true on deposit-only voluntary cancel.';
  END IF;
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before + 1 THEN
    RAISE EXCEPTION '5 FAILED: Inventory not released (before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  RAISE NOTICE '5. Deposit voluntary cancel (BD-7) -> Cancelled/Cancelled, no refund, released: PASSED';


  -- -----------------------------------------------------------------------
  -- 6. FULLY-PAID VOLUNTARY CANCEL WHILE READY
  --    Tests the policy boundary where a reservation was created with deposit (50%)
  --    but later fully settled before the customer voluntarily cancels.
  --    Using _payment_option='full' would collapse deposit=rental_price, hiding the
  --    boundary. Here we create with 'deposit', then insert both the 50% deposit row
  --    and a balance row to reach 100% paid before calling the RPC.
  --    Policy: Cancelled/Cancelled, requires_refund=false, all money forfeited.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',   -- 50% deposit; tests the excess-over-deposit boundary
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_full_vol := (v_result->>'id')::uuid;

  -- Insert deposit payment (50% of price)
  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_full_vol, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_full_vol;

  -- Insert balance payment (remaining 50%) to fully settle before Ready
  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_full_vol, v_customer_id,
         round((rental_price - deposit) * 100)::bigint, 'paid', 'balance_payment', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_full_vol;

  -- Now total_paid = rental_price (fully settled, two separate rows)
  UPDATE public.reservations
  SET status             = 'Ready',
      payment_status     = 'Paid',
      pickup_ready_at    = now() - interval '1 day',
      pickup_deadline_at = now() + interval '2 days'
  WHERE id = v_res_full_vol;

  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;
  PERFORM public.cancel_reservation_after_ready(v_res_full_vol);

  IF (SELECT status FROM public.reservations WHERE id = v_res_full_vol) <> 'Cancelled' THEN
    RAISE EXCEPTION '6 FAILED: status is % not Cancelled.', (SELECT status FROM public.reservations WHERE id = v_res_full_vol);
  END IF;
  -- Policy: Cancelled/Cancelled with no refund regardless of how much was paid above deposit.
  IF (SELECT payment_status FROM public.reservations WHERE id = v_res_full_vol) <> 'Cancelled' THEN
    RAISE EXCEPTION '6 FAILED (GAP-2): payment_status is "%" not "Cancelled". '
      '140105 hardening migration required: cancel_reservation_after_ready() must forfeit all '
      'settled payments and always produce Cancelled/Cancelled for customer-fault cancellations.',
      (SELECT payment_status FROM public.reservations WHERE id = v_res_full_vol);
  END IF;
  IF coalesce((SELECT bool_or(coalesce(requires_refund, false)) FROM public.payments
               WHERE reservation_id = v_res_full_vol), false) THEN
    RAISE EXCEPTION '6 FAILED (GAP-2): requires_refund=true on fully-paid voluntary cancel.';
  END IF;
  -- Both payment rows must be fully forfeited
  IF (SELECT coalesce(sum(forfeited_centavos), 0) FROM public.payments WHERE reservation_id = v_res_full_vol)
      <> (SELECT round(rental_price * 100)::bigint FROM public.reservations WHERE id = v_res_full_vol) THEN
    RAISE EXCEPTION '6 FAILED: Total forfeited_centavos does not match rental_price.';
  END IF;
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before + 1 THEN
    RAISE EXCEPTION '6 FAILED: Inventory not released (before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  RAISE NOTICE '6. Fully-paid (deposit+balance) voluntary cancel -> Cancelled/Cancelled, all forfeited, released: PASSED';


  -- -----------------------------------------------------------------------
  -- 7. FULLY-PAID EXPIRY -> Unclaimed / Paid
  --    7A: cancel_no_show_reservation() must REJECT fully-paid order.
  --        Hard-fail if it accepts. No state restoration (GAP-1 must surface).
  --    7B: mark_unclaimed_reservation() succeeds.
  --    7C: Inventory remains allocated (Unclaimed holds stock).
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT for creation ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'full',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_full_exp := (v_result->>'id')::uuid;

  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_full_exp, v_customer_id,
         round(rental_price * 100)::bigint, 'paid', 'full_payment', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_full_exp;

  UPDATE public.reservations
  SET status             = 'Ready',
      payment_status     = 'Paid',
      pickup_ready_at    = now() - interval '5 days',
      pickup_deadline_at = now() - interval '1 hour'
  WHERE id = v_res_full_exp;

  -- 7A: cancel_no_show_reservation must REJECT a fully-paid order
  -- === CONTEXT: no JWT needed (SECURITY DEFINER, no caller check) ===
  BEGIN
    PERFORM public.cancel_no_show_reservation(v_res_full_exp);
    -- If we reach here: RPC accepted the call. Hard-fail. Do not restore state.
    RAISE EXCEPTION '7A FAILED (GAP-1): cancel_no_show_reservation() accepted a fully-paid order. '
      'It must RAISE check_violation when total_paid >= rental_price * 100. '
      'Add guard: IF v_total_paid >= round(coalesce(v_res.rental_price,0)*100)::bigint THEN RAISE EXCEPTION.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '7A. cancel_no_show_reservation() rejected fully-paid order: PASSED';
  END;

  -- 7B: mark_unclaimed_reservation succeeds
  -- Take stock snapshot BEFORE the call so 7C has a real pre/post comparison.
  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;
  PERFORM public.mark_unclaimed_reservation(v_res_full_exp);

  IF (SELECT status FROM public.reservations WHERE id = v_res_full_exp) <> 'Unclaimed' THEN
    RAISE EXCEPTION '7B FAILED: status is % not Unclaimed.', (SELECT status FROM public.reservations WHERE id = v_res_full_exp);
  END IF;
  IF (SELECT payment_status FROM public.reservations WHERE id = v_res_full_exp) <> 'Paid' THEN
    RAISE EXCEPTION '7B FAILED: payment_status changed from Paid to %.', (SELECT payment_status FROM public.reservations WHERE id = v_res_full_exp);
  END IF;

  -- 7C: Inventory must NOT be released by mark_unclaimed_reservation
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before THEN
    RAISE EXCEPTION '7C FAILED: mark_unclaimed_reservation() released inventory (before=%, after=%). '
      'Unclaimed must hold stock.', v_stock_before, v_stock_after;
  END IF;
  IF NOT public.reservation_holds_stock('Unclaimed', false) THEN
    RAISE EXCEPTION '7C FAILED: reservation_holds_stock() returns false for Unclaimed status.';
  END IF;
  RAISE NOTICE '7B/7C. mark_unclaimed_reservation() -> Unclaimed/Paid; stock unchanged (%), held: PASSED', v_stock_before;


  -- -----------------------------------------------------------------------
  -- 8. UNCLAIMED -> COMPLETED via complete_reservation_handover()
  --    Tests both the two-argument canonical overload and the no-arg overload.
  -- -----------------------------------------------------------------------

  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;

  -- === CONTEXT: staff JWT -- complete_reservation_handover checks is_admin_or_owner() ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  -- Two-arg canonical overload
  PERFORM public.complete_reservation_handover(v_res_full_exp, 'cash');

  IF (SELECT status FROM public.reservations WHERE id = v_res_full_exp) <> 'Completed' THEN
    RAISE EXCEPTION '8a FAILED: status is % after two-arg handover.', (SELECT status FROM public.reservations WHERE id = v_res_full_exp);
  END IF;
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before + 1 THEN
    RAISE EXCEPTION '8a FAILED: Inventory not released after Completed (before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  RAISE NOTICE '8a. complete_reservation_handover(id, method): Unclaimed -> Completed, inventory released: PASSED';

  -- No-arg overload: fresh Unclaimed fixture
  DECLARE
    v_res_ol  uuid;
    v_ol_res  jsonb;
  BEGIN
    -- === CONTEXT: customer JWT for creation ===
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

    v_ol_res := public.create_reservation_multi_idempotent(
      _idempotency_key      := gen_random_uuid(),
      _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
      _payment_option       := 'full',
      _customer_id          := v_customer_id,
      _pickup_terms_version := 'v2026-09-pickup'
    );
    v_res_ol := (v_ol_res->>'id')::uuid;

    INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
    SELECT v_res_ol, v_customer_id,
           round(rental_price * 100)::bigint, 'paid', 'full_payment', 'PHP', 'manual'
    FROM public.reservations WHERE id = v_res_ol;

    UPDATE public.reservations
    SET status = 'Unclaimed', payment_status = 'Paid'
    WHERE id = v_res_ol;

    -- === CONTEXT: staff JWT for handover ===
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

    PERFORM public.complete_reservation_handover(v_res_ol);   -- no-arg overload

    IF (SELECT status FROM public.reservations WHERE id = v_res_ol) <> 'Completed' THEN
      RAISE EXCEPTION '8b FAILED: no-arg overload did not complete handover (status=%).', (SELECT status FROM public.reservations WHERE id = v_res_ol);
    END IF;
    RAISE NOTICE '8b. complete_reservation_handover(id): no-arg overload -> Completed: PASSED';
  END;


  -- -----------------------------------------------------------------------
  -- 9. LEGACY RESERVATION GRANDFATHER EXCLUSION
  --    NULL pickup_terms_accepted_at must cause the sweep to skip the row.
  -- -----------------------------------------------------------------------

  -- === CONTEXT: no JWT needed for direct UPDATE (within transaction) ===
  UPDATE public.reservations
  SET pickup_terms_version      = NULL,
      pickup_terms_accepted_at  = NULL,
      status                    = 'Ready',
      payment_status            = 'Deposit Paid',
      pickup_ready_at           = now() - interval '5 days',
      pickup_deadline_at        = now() - interval '1 hour'
  WHERE id = v_res_legacy;

  -- Payment row for v_res_legacy so it would be eligible if terms weren't NULL
  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_legacy, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_legacy
  ON CONFLICT DO NOTHING;

  PERFORM public.sweep_pickup_deadlines();

  IF (SELECT status FROM public.reservations WHERE id = v_res_legacy) IN ('Cancelled', 'Unclaimed') THEN
    RAISE EXCEPTION '9 FAILED: Legacy reservation (NULL terms) was mutated to % by sweep.',
      (SELECT status FROM public.reservations WHERE id = v_res_legacy);
  END IF;
  RAISE NOTICE '9. Legacy reservation (NULL pickup_terms_accepted_at) bypassed by sweep: PASSED';


  -- -----------------------------------------------------------------------
  -- 10. MERCHANT-FAULT SEPARATION via cancel_reservation_as_manager()
  --     10a: Customer cannot call it (authorization).
  --     10b: Staff cancels. Refund Required set, forfeited_centavos = 0
  --          (merchant-fault does not forfeit customer payments).
  -- -----------------------------------------------------------------------

  -- 10a: Customer cannot call cancel_reservation_as_manager.
  -- Use boolean flag pattern: set flag inside EXCEPTION block, evaluate outside it.
  -- This prevents the WHEN OTHERS handler from catching our own sentinel RAISE EXCEPTION
  -- and printing PASSED when the RPC actually succeeded (false-pass).
  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  DECLARE v_10a_rejected boolean := false;
  BEGIN
    BEGIN
      PERFORM public.cancel_reservation_as_manager(v_res_phase2, 'To Pay', 'Test');
    EXCEPTION WHEN OTHERS THEN
      v_10a_rejected := true;
    END;
    IF NOT v_10a_rejected THEN
      RAISE EXCEPTION '10a FAILED: Customer called cancel_reservation_as_manager() successfully (not rejected).';
    END IF;
    RAISE NOTICE '10a. cancel_reservation_as_manager() correctly restricted to staff/admin: PASSED';
  END;

  -- 10b: Staff cancels as merchant fault
  -- Insert a payment row for v_res_phase2
  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_phase2, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_phase2;

  -- === CONTEXT: staff JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  PERFORM public.cancel_reservation_as_manager(v_res_phase2, 'To Pay', 'Item defective -- merchant fault');

  IF (SELECT status FROM public.reservations WHERE id = v_res_phase2) <> 'Cancelled' THEN
    RAISE EXCEPTION '10b FAILED: status is % not Cancelled.', (SELECT status FROM public.reservations WHERE id = v_res_phase2);
  END IF;
  -- Merchant fault: customer gets refund -> Refund Required (not Cancelled)
  IF (SELECT payment_status FROM public.reservations WHERE id = v_res_phase2) <> 'Refund Required' THEN
    RAISE EXCEPTION '10b FAILED: payment_status is % not Refund Required for merchant-fault cancel.',
      (SELECT payment_status FROM public.reservations WHERE id = v_res_phase2);
  END IF;
  -- No forfeiture written on payment rows (customer-fault forfeiture must not appear here)
  IF coalesce((SELECT sum(coalesce(forfeited_centavos, 0)) FROM public.payments
               WHERE reservation_id = v_res_phase2), 0) > 0 THEN
    RAISE EXCEPTION '10b FAILED: forfeited_centavos > 0 on merchant-fault cancel.';
  END IF;
  RAISE NOTICE '10b. Merchant-fault cancel: Refund Required, forfeited_centavos=0: PASSED';


  -- -----------------------------------------------------------------------
  -- 11. SWEEP IDEMPOTENCY -- run twice, assertions scoped to test reservation
  -- -----------------------------------------------------------------------

  -- === CONTEXT: customer JWT ===
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_customer_id::text, 'role', 'authenticated')::text, true);

  v_result := public.create_reservation_multi_idempotent(
    _idempotency_key      := gen_random_uuid(),
    _items                := ('[{"product_id":"' || v_product_id::text || '","quantity":1}]')::jsonb,
    _payment_option       := 'deposit',
    _customer_id          := v_customer_id,
    _pickup_terms_version := 'v2026-09-pickup'
  );
  v_res_idempotent := (v_result->>'id')::uuid;

  INSERT INTO public.payments (reservation_id, user_id, amount_centavos, status, purpose, currency, provider)
  SELECT v_res_idempotent, v_customer_id,
         round(deposit * 100)::bigint, 'paid', 'initial_deposit', 'PHP', 'manual'
  FROM public.reservations WHERE id = v_res_idempotent;

  UPDATE public.reservations
  SET status             = 'Ready',
      payment_status     = 'Deposit Paid',
      pickup_ready_at    = now() - interval '5 days',
      pickup_deadline_at = now() - interval '1 hour'
  WHERE id = v_res_idempotent;

  -- Baseline: dedup key must not exist yet
  SELECT count(*) INTO v_dedup_before FROM public.notification_events_dedup
  WHERE event_key = 'pickup_expired:' || v_res_idempotent::text;
  IF v_dedup_before <> 0 THEN
    RAISE EXCEPTION '11 SETUP: Dedup key already exists before first sweep.';
  END IF;

  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product_id;

  -- Sweep 1
  PERFORM public.sweep_pickup_deadlines();

  IF (SELECT status FROM public.reservations WHERE id = v_res_idempotent) <> 'Cancelled' THEN
    RAISE EXCEPTION '11 FAILED: First sweep did not cancel deposit-only expired reservation.';
  END IF;
  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before + 1 THEN
    RAISE EXCEPTION '11 FAILED: Inventory not released after first sweep (before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  SELECT count(*) INTO v_dedup_after FROM public.notification_events_dedup
  WHERE event_key = 'pickup_expired:' || v_res_idempotent::text;
  IF v_dedup_after <> 1 THEN
    RAISE EXCEPTION '11 FAILED: Dedup key not inserted after first sweep (count=%).', v_dedup_after;
  END IF;

  -- Capture post-sweep-1 stock for comparison
  v_stock_before := v_stock_after;

  -- Sweep 2: must be a complete no-op for this reservation
  PERFORM public.sweep_pickup_deadlines();

  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product_id;
  IF v_stock_after <> v_stock_before THEN
    RAISE EXCEPTION '11 FAILED: Second sweep changed inventory (duplicate release, before=%, after=%).', v_stock_before, v_stock_after;
  END IF;
  SELECT count(*) INTO v_dedup_after FROM public.notification_events_dedup
  WHERE event_key = 'pickup_expired:' || v_res_idempotent::text;
  IF v_dedup_after <> 1 THEN
    RAISE EXCEPTION '11 FAILED: Second sweep inserted duplicate dedup key (count=%).', v_dedup_after;
  END IF;

  RAISE NOTICE '11. Sweep idempotency: second sweep = no-op (stock, dedup unchanged): PASSED';


  RAISE NOTICE '==========================================================';
  RAISE NOTICE 'All assertions reached. Check for FAILED messages above.';
  RAISE NOTICE 'Rolling back all fixtures...';
  RAISE NOTICE '==========================================================';

END $$;

ROLLBACK;
-- All synthetic users, products, reservations, payments, dedup rows,
-- and store_hours mutations are rolled back. Live data is unaffected.


-- =================================================================================
-- SHARED-DB SAFE: Pre-cron Candidate Report (Case 12)
-- Run ONLY this section against the shared production database.
-- Read-only SELECT. Mirrors the exact WHERE predicate and financial
-- classification logic inside sweep_pickup_deadlines().
-- =================================================================================
SELECT
  r.display_id,
  r.id                                                            AS reservation_id,
  r.status,
  r.payment_status,
  r.pickup_deadline_at AT TIME ZONE 'Asia/Manila'                AS deadline_manila,
  now() AT TIME ZONE 'Asia/Manila'                               AS now_manila,
  (now() - r.pickup_deadline_at)                                 AS overdue_by,
  r.extension_status,
  r.pickup_terms_accepted_at                                     AS terms_accepted_at,
  round(r.rental_price, 2)                                       AS rental_price,
  coalesce(
    (SELECT round(sum(p.amount_centavos) / 100.0, 2)
     FROM public.payments p
     WHERE p.reservation_id = r.id
       AND p.status = 'paid'
       AND p.refund_disbursed_at IS NULL), 0)                    AS total_paid,
  -- Sweep predicate financial classification (mirrors sweep_pickup_deadlines exactly)
  CASE
    WHEN coalesce(
      (SELECT sum(p.amount_centavos) FROM public.payments p
       WHERE p.reservation_id = r.id
         AND p.status = 'paid'
         AND p.refund_disbursed_at IS NULL), 0
    ) >= round(coalesce(r.rental_price, 0) * 100)::bigint
    THEN 'UNCLAIMED'
    ELSE 'CANCEL'
  END                                                            AS predicted_sweep_action
FROM public.reservations r
WHERE
  -- Exact copy of sweep_pickup_deadlines() candidate query
  coalesce(r.deleted, false) = false
  AND lower(trim(coalesce(r.status, ''))) IN ('ready', 'to pickup')
  AND r.pickup_deadline_at IS NOT NULL
  AND r.pickup_deadline_at < now()
  AND coalesce(r.extension_status, '') <> 'pending'
  AND r.pickup_terms_accepted_at IS NOT NULL
ORDER BY r.pickup_deadline_at ASC;
