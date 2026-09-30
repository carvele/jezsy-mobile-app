-- ============================================================
-- Migration: 20260930100000_content_moderation.sql
-- Content Moderation Layer  English + Filipino / Tagalog / Taglish
-- ============================================================
-- Architecture:
--   private schema                         (never exposed by PostgREST)
--   private.moderation_terms               vocabulary
--   private.moderation_allowlist           safe-word overrides
--   private.normalize_for_moderation()     normalization pipeline
--   private.find_moderation_match()        token / phrase matching
--   private.assert_clean_text()            raises PT422 on blocked content
--
-- Integration points:
--   1. public.submit_verified_review          p_comment
--   2. public.reviews BEFORE UPDATE trigger   comment, admin_reply
--   3. public.messages BEFORE INSERT trigger  text
--   4. public.messages BEFORE UPDATE trigger  text (edit)
--   5. public.direct_messages BEFORE INSERT   content
--   6. public.direct_messages BEFORE UPDATE   content (edit)
--   7. public.cancel_customer_reservation     _reason
--   8. public.request_customer_refund         _details
--   9. public.request_reschedule_v2           _reason
--  10. public.request_ready_cancellation      _reason
--  11. public.cancel_reservation_as_manager   _reason
--
-- Error contract: SQLSTATE PT422 / CONTENT_MODERATION_BLOCKED
-- ============================================================

-- 0. Private schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE CREATE ON SCHEMA private FROM PUBLIC;

-- 1. Vocabulary table
CREATE TABLE IF NOT EXISTS private.moderation_terms (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical  text        NOT NULL,
  language   text        NOT NULL DEFAULT 'mixed',
  severity   int         NOT NULL DEFAULT 1 CHECK (severity BETWEEN 0 AND 3),
  match_type text        NOT NULL DEFAULT 'token' CHECK (match_type IN ('token','phrase')),
  enabled    boolean     NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_terms_canonical_uq UNIQUE (canonical)
);
CREATE INDEX IF NOT EXISTS idx_moderation_terms_enabled
  ON private.moderation_terms (enabled) WHERE enabled = true;
REVOKE ALL ON private.moderation_terms FROM PUBLIC, anon, authenticated;

-- 2. Allowlist table
CREATE TABLE IF NOT EXISTS private.moderation_allowlist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  word       text        NOT NULL,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_allowlist_word_uq UNIQUE (word)
);
REVOKE ALL ON private.moderation_allowlist FROM PUBLIC, anon, authenticated;

-- 3. Vocabulary seed (reviewed, high-confidence terms only)
INSERT INTO private.moderation_terms (canonical, language, severity, match_type, notes) VALUES
  ('gago',       'fil', 2, 'token',  'Filipino: stupid/idiot'),
  ('gaga',       'fil', 2, 'token',  'Filipino: stupid/idiot (feminine)'),
  ('putang ina', 'fil', 3, 'phrase', 'Filipino: serious expletive'),
  ('putangina',  'fil', 3, 'token',  'Filipino: contracted form'),
  ('tangina',    'fil', 3, 'token',  'Filipino: clipped form'),
  ('tang ina',   'fil', 3, 'phrase', 'Filipino: spaced form'),
  ('puta',       'fil', 2, 'token',  'Filipino/Spanish: expletive'),
  ('tarantado',  'fil', 2, 'token',  'Filipino: stupid/incompetent'),
  ('ulol',       'fil', 2, 'token',  'Filipino: crazy/stupid'),
  ('bobo',       'fil', 1, 'token',  'Filipino: stupid'),
  ('boba',       'fil', 1, 'token',  'Filipino: stupid (feminine)'),
  ('tanga',      'fil', 2, 'token',  'Filipino: stupid/dumb'),
  ('hunghang',   'fil', 1, 'token',  'Filipino: dumb'),
  ('lintik',     'fil', 2, 'token',  'Filipino: expletive (lightning)'),
  ('buwisit',    'fil', 1, 'token',  'Filipino: mild expletive'),
  ('leche',      'fil', 1, 'token',  'Filipino: mild expletive'),
  ('punyeta',    'fil', 2, 'token',  'Filipino: expletive'),
  ('putcha',     'fil', 2, 'token',  'Filipino: softened expletive'),
  ('puke',       'fil', 2, 'token',  'Filipino: vulgar anatomical'),
  ('tite',       'fil', 2, 'token',  'Filipino: vulgar anatomical'),
  ('pakyu',      'fil', 3, 'token',  'Taglish: f*** you phonetic'),
  ('pakyo',      'fil', 3, 'token',  'Taglish: variant'),
  ('hayop',      'fil', 1, 'token',  'Filipino: animal-based insult'),
  ('fuck',       'en',  3, 'token',  'English: strong expletive'),
  ('fucker',     'en',  3, 'token',  'English: variant'),
  ('fucking',    'en',  3, 'token',  'English: adjective form'),
  ('fuk',        'en',  3, 'token',  'English: obfuscated variant'),
  ('fck',        'en',  3, 'token',  'English: abbreviated variant'),
  ('shit',       'en',  2, 'token',  'English: expletive'),
  ('shyt',       'en',  2, 'token',  'English: variant'),
  ('asshole',    'en',  2, 'token',  'English: insult'),
  ('ass',        'en',  1, 'token',  'English: mild, token-boundary only'),
  ('bitch',      'en',  2, 'token',  'English: insult'),
  ('bastard',    'en',  2, 'token',  'English: insult'),
  ('cunt',       'en',  3, 'token',  'English: severe'),
  ('dick',       'en',  2, 'token',  'English: anatomical insult'),
  ('cock',       'en',  2, 'token',  'English: anatomical insult'),
  ('prick',      'en',  2, 'token',  'English: insult'),
  ('whore',      'en',  3, 'token',  'English: derogatory'),
  ('slut',       'en',  3, 'token',  'English: derogatory'),
  ('idiot',      'en',  1, 'token',  'English: insult'),
  ('moron',      'en',  1, 'token',  'English: insult'),
  ('retard',     'en',  2, 'token',  'English: ableist insult'),
  ('stupid',     'en',  1, 'token',  'English: mild insult')
ON CONFLICT (canonical) DO NOTHING;

-- Allowlist seed
INSERT INTO private.moderation_allowlist (word, notes) VALUES
  ('putahe',   'Filipino food/dish word -- contains puta as substring'),
  ('classic',  'Contains ass as substring'),
  ('class',    'Contains ass as substring'),
  ('mass',     'Contains ass as substring'),
  ('bass',     'Musical/fish term'),
  ('pass',     'Legitimate'),
  ('grass',    'Legitimate'),
  ('glass',    'Legitimate'),
  ('brass',    'Legitimate'),
  ('sass',     'Legitimate'),
  ('hassle',   'Legitimate'),
  ('assure',   'Legitimate'),
  ('assist',   'Legitimate'),
  ('asset',    'Legitimate'),
  ('assign',   'Legitimate'),
  ('assume',   'Legitimate'),
  ('cockpit',  'Aviation term'),
  ('cockatoo', 'Bird name'),
  ('cockerel', 'Young rooster'),
  ('hancock',  'Proper name')
ON CONFLICT (word) DO NOTHING;

-- 4. Normalization function
-- Produces a detection-only copy; original text is NEVER rewritten.
CREATE OR REPLACE FUNCTION private.normalize_for_moderation(p_text text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v     text;
  i     int;
  v_prev text;
BEGIN
  IF p_text IS NULL THEN RETURN ''; END IF;
  v := lower(normalize(p_text, NFC));

  -- Strip invisible/zero-width chars (soft-hyphen U+00AD, ZWS U+200B, BOM U+FEFF)
  v := regexp_replace(v, E'\u00AD|\u200B|\u200C|\u200D|\u200E|\u200F|\uFEFF|\u180E', '', 'g');

  -- Controlled leetspeak map
  v := replace(v, '4', 'a');
  v := replace(v, '@', 'a');
  v := replace(v, '3', 'e');
  v := replace(v, '1', 'i');
  v := replace(v, '!', 'i');
  v := replace(v, '0', 'o');
  v := replace(v, '5', 's');
  v := replace(v, '$', 's');
  v := replace(v, '7', 't');
  v := replace(v, '*', '');   -- f**k -> fk (still caught by fk term or token match)

  -- Collapse runs of 3+ identical chars to 2
  v := regexp_replace(v, '(.){2,}', '', 'g');

  -- Normalize separator-split letters: g.a.g.o -> gago (up to 20 passes)
  FOR i IN 1..20 LOOP
    v_prev := v;
    v := regexp_replace(v, '([[:alnum:]])[.\-_]([[:alnum:]])[.\-_]([[:alnum:]])', '', 'g');
    v := regexp_replace(v, '([[:alnum:]])[.\-_]([[:alnum:]])', '', 'g');
    EXIT WHEN v = v_prev;
  END LOOP;

  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_for_moderation(text) FROM PUBLIC, anon, authenticated;

-- 5. Matching function
CREATE OR REPLACE FUNCTION private.find_moderation_match(p_normalized_text text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
DECLARE
  v_normalized text;
  v_term      record;
  v_collapsed text;
  v_pattern   text;
BEGIN
  IF p_normalized_text IS NULL OR p_normalized_text = '' THEN
    RETURN NULL;
  END IF;

  -- Ensure text is normalized even if caller passed raw un-normalized text
  v_normalized := private.normalize_for_moderation(p_normalized_text);
  IF v_normalized IS NULL OR v_normalized = '' THEN
    RETURN NULL;
  END IF;

  -- Secondary collapse: runs of 2+ identical chars -> 1 (gagoo -> gago -> match)
  v_collapsed := regexp_replace(v_normalized, '(.)\1+', '\1', 'g');

  FOR v_term IN
    SELECT canonical, match_type
    FROM private.moderation_terms
    WHERE enabled = true AND severity > 0
    ORDER BY severity DESC, length(canonical) DESC
  LOOP
    -- Skip if canonical is itself allowlisted
    IF EXISTS (SELECT 1 FROM private.moderation_allowlist WHERE word = v_term.canonical) THEN
      CONTINUE;
    END IF;

    -- Build word-boundary pattern (spaces in phrase terms become flexible)
    v_pattern := '\y' || regexp_replace(v_term.canonical, '\s+', '[[:space:]]*', 'g') || '\y';

    IF v_collapsed ~* v_pattern OR v_normalized ~* v_pattern THEN
      -- Allowlist guard: if a safe word also matches, skip
      IF NOT EXISTS (
        SELECT 1 FROM private.moderation_allowlist al
        WHERE v_collapsed ~* ('\y' || regexp_replace(al.word, '\s+', '[[:space:]]*', 'g') || '\y')
      ) THEN
        RETURN v_term.canonical;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.find_moderation_match(text) FROM PUBLIC, anon, authenticated;

-- 6. assert_clean_text -- single entry point for all write paths
CREATE OR REPLACE FUNCTION private.assert_clean_text(
  p_text    text,
  p_surface text DEFAULT 'content'
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
DECLARE
  v_normalized text;
  v_matched    text;
  v_hint       text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN; END IF;

  v_normalized := private.normalize_for_moderation(p_text);
  v_matched    := private.find_moderation_match(v_normalized);

  IF v_matched IS NOT NULL THEN
    v_hint := CASE p_surface
      WHEN 'review'  THEN 'Please remove inappropriate or offensive language before submitting.'
      WHEN 'message' THEN 'Please remove inappropriate or offensive language before sending.'
      WHEN 'reply'   THEN 'Please remove inappropriate or offensive language before submitting.'
      WHEN 'reason'  THEN 'Please remove inappropriate or offensive language from your reason.'
      ELSE                'Please remove inappropriate or offensive language.'
    END;
    RAISE EXCEPTION 'CONTENT_MODERATION_BLOCKED'
      USING ERRCODE = 'PT422', HINT = v_hint;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_clean_text(text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- INTEGRATION 1: submit_verified_review
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_verified_review(
  p_reservation_item_id uuid,
  p_rating   int,
  p_comment  text    DEFAULT NULL,
  p_images   text[]  DEFAULT ARRAY[]::text[]
)
RETURNS public.reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_product_id uuid;
  v_size       text;
  v_color      text;
  v_customer_id uuid;
  v_status     text;
  v_new_review public.reviews;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Staff accounts cannot submit customer reviews.'
      USING ERRCODE = '42501';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- *** MODERATION CHECK ***
  PERFORM private.assert_clean_text(p_comment, 'review');

  SELECT ri.product_id, ri.size, ri.color, res.customer_id, res.status
  INTO   v_product_id, v_size, v_color, v_customer_id, v_status
  FROM   public.reservation_items ri
  JOIN   public.reservations res ON res.id = ri.reservation_id
  WHERE  ri.id = p_reservation_item_id
    AND  coalesce(res.deleted, false) = false;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Reservation item not found';
  END IF;
  IF v_customer_id <> v_uid THEN
    RAISE EXCEPTION 'You can only review items from your own reservations';
  END IF;
  IF v_status <> 'Completed' THEN
    RAISE EXCEPTION 'Only completed reservations can be reviewed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reviews WHERE reservation_item_id = p_reservation_item_id) THEN
    RAISE EXCEPTION 'This reservation item has already been reviewed';
  END IF;

  INSERT INTO public.reviews (
    product_id, user_id, reservation_item_id, size, color,
    rating, comment, images, verified_purchase
  ) VALUES (
    v_product_id, v_uid, p_reservation_item_id, v_size, v_color,
    p_rating, p_comment, p_images, true
  )
  RETURNING * INTO v_new_review;

  RETURN v_new_review;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_verified_review(uuid, integer, text, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_verified_review(uuid, integer, text, text[]) TO authenticated;

-- ============================================================
-- INTEGRATION 2: reviews BEFORE UPDATE -- comment and admin_reply
-- ============================================================
CREATE OR REPLACE FUNCTION public.moderate_review_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NEW.comment IS DISTINCT FROM OLD.comment THEN
    PERFORM private.assert_clean_text(NEW.comment, 'review');
  END IF;
  IF NEW.admin_reply IS DISTINCT FROM OLD.admin_reply THEN
    PERFORM private.assert_clean_text(NEW.admin_reply, 'reply');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_review_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_moderate_review_update ON public.reviews;
CREATE TRIGGER trg_moderate_review_update
  BEFORE UPDATE OF comment, admin_reply ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.moderate_review_update();

-- ============================================================
-- INTEGRATION 3+4: messages BEFORE INSERT and BEFORE UPDATE
-- Fires before AFTER INSERT triggers (sync_conversation, notify_admin)
-- so blocked messages produce zero side effects.
-- ============================================================
CREATE OR REPLACE FUNCTION public.moderate_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  -- Auto-responses and system messages bypass moderation
  IF coalesce(NEW.is_auto_response, false) = true
     OR coalesce(NEW.sender_type, '') = 'auto_response' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM private.assert_clean_text(NEW.text, 'message');
  ELSIF TG_OP = 'UPDATE' AND NEW.text IS DISTINCT FROM OLD.text THEN
    PERFORM private.assert_clean_text(NEW.text, 'message');
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_moderate_message_insert ON public.messages;
CREATE TRIGGER trg_moderate_message_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.moderate_message();

DROP TRIGGER IF EXISTS trg_moderate_message_update ON public.messages;
CREATE TRIGGER trg_moderate_message_update
  BEFORE UPDATE OF text ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.moderate_message();

-- ============================================================
-- INTEGRATION 5+6: direct_messages BEFORE INSERT and BEFORE UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.moderate_direct_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.assert_clean_text(NEW.content, 'message');
  ELSIF TG_OP = 'UPDATE' AND NEW.content IS DISTINCT FROM OLD.content THEN
    PERFORM private.assert_clean_text(NEW.content, 'message');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_direct_message() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'direct_messages' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_moderate_direct_message_insert ON public.direct_messages';
    EXECUTE 'CREATE TRIGGER trg_moderate_direct_message_insert
               BEFORE INSERT ON public.direct_messages
               FOR EACH ROW EXECUTE FUNCTION public.moderate_direct_message()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_moderate_direct_message_update ON public.direct_messages';
    EXECUTE 'CREATE TRIGGER trg_moderate_direct_message_update
               BEFORE UPDATE OF content ON public.direct_messages
               FOR EACH ROW EXECUTE FUNCTION public.moderate_direct_message()';
  END IF;
END $$;

-- ============================================================
-- INTEGRATION 7: cancel_customer_reservation
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_customer_reservation(
  _reservation_id uuid,
  _reason         text DEFAULT 'Cancelled by customer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_res     reservations%rowtype;
  v_status  text;
  v_pstatus text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- *** MODERATION CHECK ***
  PERFORM private.assert_clean_text(_reason, 'reason');

  SELECT * INTO v_res FROM reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_res.customer_id <> v_actor THEN
    RAISE EXCEPTION 'You do not own this reservation.' USING ERRCODE = '42501';
  END IF;

  v_status  := lower(trim(coalesce(v_res.status, '')));
  v_pstatus := lower(trim(coalesce(v_res.payment_status, '')));

  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true);
  END IF;
  IF v_status NOT IN ('to pay', 'confirmed') THEN
    RAISE EXCEPTION 'Only reservations awaiting payment can be cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pstatus IN ('paid','deposit paid','partially paid','submitted','processing','refund required','refunded') THEN
    RAISE EXCEPTION 'A reservation with payment activity cannot be cancelled directly.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.reservation_id = _reservation_id
      AND lower(trim(coalesce(p.status,''))) IN ('paid','processing')
  ) THEN
    RAISE EXCEPTION 'Payment in progress; cannot cancel.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE reservations
  SET status              = 'Cancelled',
      cancellation_reason = coalesce(nullif(trim(_reason),''), 'Cancelled by customer'),
      updated_at          = now()
  WHERE id = _reservation_id;

  RETURN jsonb_build_object('success', true, 'reservation_id', _reservation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_customer_reservation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_customer_reservation(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_customer_reservation(uuid, text) TO authenticated;

-- ============================================================
-- INTEGRATION 8: request_customer_refund
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_customer_refund(
  _reservation_id  uuid,
  _reason_category text,
  _details         text DEFAULT NULL,
  _photo_path      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_res           reservations%rowtype;
  v_req           return_refund_requests%rowtype;
  v_trimmed_reason text := trim(coalesce(_reason_category, ''));
  v_display       text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_trimmed_reason = '' THEN
    RAISE EXCEPTION 'Reason category is required.' USING ERRCODE = 'check_violation';
  END IF;

  -- *** MODERATION CHECKS ***
  PERFORM private.assert_clean_text(_reason_category, 'reason');
  PERFORM private.assert_clean_text(_details, 'reason');

  SELECT * INTO v_res FROM reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_res.customer_id <> v_actor THEN
    RAISE EXCEPTION 'You do not own this reservation.' USING ERRCODE = '42501';
  END IF;
  IF lower(trim(coalesce(v_res.status,''))) <> 'completed' THEN
    RAISE EXCEPTION 'Only completed reservations can request a return or refund.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.is_reservation_return_eligible(_reservation_id) THEN
    RAISE EXCEPTION 'The return request window for this reservation has expired.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM return_refund_requests
    WHERE reservation_id = _reservation_id
      AND status IN ('submitted','under_review','approved')
  ) THEN
    RAISE EXCEPTION 'An active return or refund request already exists for this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO return_refund_requests (
    reservation_id, customer_id, reason_category, details, photo_path, status
  )
  VALUES (
    _reservation_id, v_actor, v_trimmed_reason,
    nullif(trim(_details),''), nullif(trim(_photo_path),''), 'submitted'
  )
  RETURNING * INTO v_req;

  v_display := coalesce(v_res.display_id, substring(_reservation_id::text from 1 for 8));

  INSERT INTO admin_notifications (title, message, type)
  VALUES (
    'New return/refund request',
    'Customer requested return/refund for reservation #' || v_display || '.',
    'ReturnRequest'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req.id,
    'status', v_req.status,
    'submitted_at', v_req.submitted_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_customer_refund(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_customer_refund(uuid, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.request_customer_refund(uuid, text, text, text) TO authenticated;

-- ============================================================
-- INTEGRATION 9: request_reschedule_v2
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_reschedule_v2(
  _reservation_id uuid,
  _new_date       date,
  _new_time       time,
  _reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_res        public.reservations%rowtype;
  v_reason     text := btrim(coalesce(_reason, ''));
  v_target     timestamptz;
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Please tell the boutique why you need a new time.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  -- *** MODERATION CHECK ***
  PERFORM private.assert_clean_text(v_reason, 'reason');

  PERFORM public.assert_reservation_command_rate('reschedule_v2', _reservation_id);

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(coalesce(v_res.status,''))) NOT IN ('confirmed','to pay','to pickup','ready','active') THEN
    RAISE EXCEPTION 'Reschedule is only available for active reservations.' USING ERRCODE = 'check_violation';
  END IF;
  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'A change request is already pending for this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  v_target := ((_new_date::text || ' ' || _new_time::text)::timestamp AT TIME ZONE 'Asia/Manila');
  PERFORM public.assert_bookable_slot(_new_date, _new_time, _reservation_id);

  INSERT INTO public.reservation_change_requests (
    reservation_id, customer_id, request_type, reason,
    requested_for, original_for,
    reservation_status_at_request, payment_status_at_request
  ) VALUES (
    _reservation_id, v_actor, 'reschedule', v_reason,
    v_target, v_res.appointment_time,
    v_res.status, v_res.payment_status
  )
  RETURNING id INTO v_request_id;

  BEGIN
    INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id)
    VALUES (
      'Reschedule Request',
      'Customer requested to reschedule reservation ' ||
        coalesce(v_res.display_id, substring(_reservation_id::text for 8)) || '.',
      'RescheduleRequest', 'reservation', _reservation_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'request_reschedule_v2: admin notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'change_request_id', v_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.request_reschedule_v2(uuid, date, time, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_reschedule_v2(uuid, date, time, text) TO authenticated;

-- ============================================================
-- INTEGRATION 10: request_ready_cancellation
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_ready_cancellation(_reservation_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_res        public.reservations%rowtype;
  v_reason     text := btrim(coalesce(_reason, ''));
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Please tell the boutique why you want to cancel.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer.' USING ERRCODE = 'check_violation';
  END IF;

  -- *** MODERATION CHECK ***
  PERFORM private.assert_clean_text(v_reason, 'reason');

  PERFORM public.assert_reservation_command_rate('cancel_ready', _reservation_id);

  SELECT * INTO v_res FROM public.reservations
  WHERE id = _reservation_id AND customer_id = v_actor AND coalesce(deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;
  IF lower(trim(coalesce(v_res.status,''))) NOT IN ('to pickup','ready','active') THEN
    RAISE EXCEPTION 'Cancellation request is only available when reservation is ready for pickup.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.has_pending_blocking_reservation_change(_reservation_id) THEN
    RAISE EXCEPTION 'A change request is already pending for this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.reservation_change_requests (
    reservation_id, customer_id, request_type, reason,
    requested_for, original_for,
    reservation_status_at_request, payment_status_at_request
  ) VALUES (
    _reservation_id, v_actor, 'cancel_ready', v_reason,
    NULL, v_res.appointment_time,
    v_res.status, v_res.payment_status
  )
  RETURNING id INTO v_request_id;

  BEGIN
    INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id)
    VALUES (
      'Cancellation Request',
      'Customer requested cancellation for reservation ' ||
        coalesce(v_res.display_id, substring(_reservation_id::text for 8)) || '.',
      'CancellationRequest', 'reservation', _reservation_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'request_ready_cancellation: admin notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'change_request_id', v_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.request_ready_cancellation(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_ready_cancellation(uuid, text) TO authenticated;

-- ============================================================
-- INTEGRATION 11: cancel_reservation_as_manager
-- Staff reason is shown to the customer, so it must be moderated too.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_reservation_as_manager(
  _reservation_id  uuid,
  _expected_status text,
  _reason          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_actor              uuid := auth.uid();
  v_actor_name         text;
  v_res                public.reservations%rowtype;
  v_next_payment_status text;
  v_reason             text := btrim(coalesce(_reason, ''));
BEGIN
  IF v_actor IS NULL OR NOT public.can_operate_reservations() THEN
    RAISE EXCEPTION 'Reservation management access required.' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason shown to the customer is required.' USING ERRCODE = 'check_violation';
  END IF;

  -- *** MODERATION CHECK -- staff reason is visible to the customer ***
  PERFORM private.assert_clean_text(v_reason, 'reason');

  SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;
  IF lower(trim(coalesce(v_res.status,''))) <> lower(trim(_expected_status)) THEN
    RAISE EXCEPTION 'Reservation status has changed. Please refresh and try again.' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(trim(coalesce(v_res.status,''))) = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true);
  END IF;

  v_next_payment_status := CASE lower(trim(coalesce(v_res.payment_status,'')))
    WHEN 'paid'           THEN 'Refund Required'
    WHEN 'deposit paid'   THEN 'Refund Required'
    WHEN 'partially paid' THEN 'Refund Required'
    ELSE v_res.payment_status
  END;

  SELECT coalesce(
    nullif(trim(full_name),''),
    nullif(trim(concat_ws(' ', first_name, last_name)),''),
    'Staff'
  )
  INTO v_actor_name
  FROM public.profiles WHERE id = v_actor;

  UPDATE public.reservations
  SET status              = 'Cancelled',
      cancellation_reason = v_reason,
      payment_status      = v_next_payment_status,
      updated_at          = now()
  WHERE id = _reservation_id;

  BEGIN
    INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id)
    VALUES (
      'Reservation Cancelled by Staff',
      coalesce(v_actor_name,'Staff') || ' cancelled reservation ' ||
        coalesce(v_res.display_id, substring(_reservation_id::text for 8)) || ': ' || v_reason,
      'ReservationCancelled', 'reservation', _reservation_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cancel_reservation_as_manager: admin notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', _reservation_id,
    'new_payment_status', v_next_payment_status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_reservation_as_manager(uuid, text, text) TO authenticated;

-- ============================================================
-- PERFORMANCE: composite index for active term iteration
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_moderation_terms_active
  ON private.moderation_terms (severity DESC, length(canonical) DESC)
  WHERE enabled = true AND severity > 0;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON SCHEMA private IS
  'Non-public schema: internal helpers not exposed by PostgREST. '
  'Contains moderation vocabulary and normalization pipeline.';

COMMENT ON TABLE private.moderation_terms IS
  'Canonical moderation vocabulary. Reviewed, version-controlled, project-owned. '
  'Disable terms with enabled=false rather than deleting them.';

COMMENT ON TABLE private.moderation_allowlist IS
  'Safe-word overrides. Words here bypass moderation even if they match a term pattern. '
  'Use for legitimate words containing profane substrings (e.g., putahe, classic).';

COMMENT ON FUNCTION private.assert_clean_text(text, text) IS
  'Primary moderation entry point. Raises SQLSTATE PT422 / CONTENT_MODERATION_BLOCKED '
  'if text contains a prohibited term after normalization. Returns void if clean. '
  'p_surface: review | message | reply | reason -- controls the error hint text.';