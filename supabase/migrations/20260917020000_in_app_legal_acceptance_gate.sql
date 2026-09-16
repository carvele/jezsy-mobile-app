-- Migration: 20260917020000_in_app_legal_acceptance_gate.sql
-- Description: In-App Mandatory Legal Acceptance Gate Infrastructure
-- Enables versioned, immutable Terms and Privacy acceptance with proof-of-presentation,
-- Store Owner publishing authority, and pseudonymized audit preservation.

-- ====================================================================
-- 1. TABLES
-- ====================================================================

-- 1.1 Versioned Legal Documents Catalog
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('terms', 'privacy')),
  version text NOT NULL,
  title text NOT NULL,
  content_markdown text NOT NULL,
  content_sha256 text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_legal_documents_type_version UNIQUE (document_type, version),
  CONSTRAINT chk_active_requires_published CHECK (NOT is_active OR is_published)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_legal_document_per_type
  ON public.legal_documents (document_type)
  WHERE is_active = true;

-- Enforce immutability of published documents
CREATE OR REPLACE FUNCTION public.guard_legal_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.is_published = true THEN
    IF NEW.is_published = false THEN
      RAISE EXCEPTION 'Published legal documents cannot be unpublished.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.content_markdown IS DISTINCT FROM OLD.content_markdown
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 THEN
      RAISE EXCEPTION 'Published legal documents are immutable. Create a new version instead.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_legal_document_immutability ON public.legal_documents;
CREATE TRIGGER trg_guard_legal_document_immutability
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_legal_document_immutability();

-- 1.2 User Legal Subjects (Stable pseudonymous ID mapping)
CREATE TABLE IF NOT EXISTS public.user_legal_subjects (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_subject_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_legal_subject UNIQUE (legal_subject_id)
);

-- 1.3 Legal Document Views (Proof of Presentation / Scroll Audit)
CREATE TABLE IF NOT EXISTS public.legal_document_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  legal_subject_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
  document_version text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  client_platform text NOT NULL CHECK (client_platform IN ('mobile_ios', 'mobile_android', 'admin_web')),
  CONSTRAINT uq_user_document_view UNIQUE (legal_subject_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_document_views_lookup
  ON public.legal_document_views (legal_subject_id, document_id);

-- 1.4 Legal Acceptances (Consent Ledger)
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  legal_subject_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('terms', 'privacy')),
  document_version text NOT NULL,
  content_sha256 text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  acceptance_method text NOT NULL DEFAULT 'in_app' CHECK (acceptance_method IN ('in_app', 'admin_portal')),
  user_agent text,
  client_platform text NOT NULL CHECK (client_platform IN ('mobile_ios', 'mobile_android', 'admin_web')),
  CONSTRAINT uq_user_document_acceptance UNIQUE (legal_subject_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_lookup
  ON public.legal_acceptances (user_id, document_type, document_version);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_subject_lookup
  ON public.legal_acceptances (legal_subject_id, document_type, document_version);

-- ====================================================================
-- 2. ROW LEVEL SECURITY
-- ====================================================================

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_legal_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_read_active_legal_documents" ON public.legal_documents;
CREATE POLICY "anyone_can_read_active_legal_documents"
  ON public.legal_documents
  FOR SELECT
  TO authenticated, anon
  USING (
    is_active = true
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'
    ))
  );

DROP POLICY IF EXISTS "users_can_read_own_legal_subject" ON public.user_legal_subjects;
CREATE POLICY "users_can_read_own_legal_subject"
  ON public.user_legal_subjects
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_can_read_own_views" ON public.legal_document_views;
CREATE POLICY "users_can_read_own_views"
  ON public.legal_document_views
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_can_read_own_acceptances" ON public.legal_acceptances;
CREATE POLICY "users_can_read_own_acceptances"
  ON public.legal_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Direct client mutations revoked
REVOKE INSERT, UPDATE, DELETE ON public.legal_documents FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_legal_subjects FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.legal_document_views FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.legal_acceptances FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- 3. FUNCTIONS & RPCS
-- ====================================================================

-- 3.1 Helper: Store Owner Capability Check
CREATE OR REPLACE FUNCTION public.can_publish_legal_documents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'owner'
      AND employment_status = 'active'
      AND deleted = false
      AND is_blocked = false
  );
$$;

REVOKE ALL ON FUNCTION public.can_publish_legal_documents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_publish_legal_documents() TO authenticated;

-- 3.2 Helper: Internal Subject Resolver (Strictly Revoked from Authenticated)
CREATE OR REPLACE FUNCTION public.get_or_create_legal_subject_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT legal_subject_id INTO v_subject_id
  FROM public.user_legal_subjects
  WHERE user_id = _user_id;

  IF v_subject_id IS NULL THEN
    INSERT INTO public.user_legal_subjects (user_id, legal_subject_id)
    VALUES (_user_id, gen_random_uuid())
    ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING legal_subject_id INTO v_subject_id;
  END IF;

  RETURN v_subject_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_legal_subject_id(uuid) FROM PUBLIC, anon, authenticated;

-- 3.3 RPC: get_legal_acceptance_status()
CREATE OR REPLACE FUNCTION public.get_legal_acceptance_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subject_id uuid;
  v_terms record;
  v_privacy record;
  v_terms_accepted boolean := false;
  v_terms_viewed boolean := false;
  v_privacy_accepted boolean := false;
  v_privacy_viewed boolean := false;
  v_gate_enabled boolean := false;
  v_can_continue boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, version, title, content_markdown, content_sha256
  INTO v_terms
  FROM public.legal_documents
  WHERE document_type = 'terms' AND is_active = true
  LIMIT 1;

  SELECT id, version, title, content_markdown, content_sha256
  INTO v_privacy
  FROM public.legal_documents
  WHERE document_type = 'privacy' AND is_active = true
  LIMIT 1;

  -- Gate is disabled if either Terms or Privacy is not yet active
  IF v_terms.id IS NULL OR v_privacy.id IS NULL THEN
    RETURN jsonb_build_object(
      'gate_enabled', false,
      'can_continue', true,
      'terms', CASE WHEN v_terms.id IS NOT NULL THEN jsonb_build_object(
        'document_id', v_terms.id,
        'version', v_terms.version,
        'title', v_terms.title,
        'content_markdown', v_terms.content_markdown,
        'content_sha256', v_terms.content_sha256,
        'is_accepted', true,
        'is_viewed', true
      ) ELSE NULL END,
      'privacy', CASE WHEN v_privacy.id IS NOT NULL THEN jsonb_build_object(
        'document_id', v_privacy.id,
        'version', v_privacy.version,
        'title', v_privacy.title,
        'content_markdown', v_privacy.content_markdown,
        'content_sha256', v_privacy.content_sha256,
        'is_accepted', true,
        'is_viewed', true
      ) ELSE NULL END
    );
  END IF;

  v_gate_enabled := true;
  v_subject_id := public.get_or_create_legal_subject_id(v_user_id);

  SELECT EXISTS (
    SELECT 1 FROM public.legal_document_views
    WHERE legal_subject_id = v_subject_id AND document_id = v_terms.id
  ) INTO v_terms_viewed;

  SELECT EXISTS (
    SELECT 1 FROM public.legal_document_views
    WHERE legal_subject_id = v_subject_id AND document_id = v_privacy.id
  ) INTO v_privacy_viewed;

  SELECT EXISTS (
    SELECT 1 FROM public.legal_acceptances
    WHERE legal_subject_id = v_subject_id AND document_id = v_terms.id
  ) INTO v_terms_accepted;

  SELECT EXISTS (
    SELECT 1 FROM public.legal_acceptances
    WHERE legal_subject_id = v_subject_id AND document_id = v_privacy.id
  ) INTO v_privacy_accepted;

  v_can_continue := (v_terms_accepted AND v_privacy_accepted);

  RETURN jsonb_build_object(
    'gate_enabled', v_gate_enabled,
    'can_continue', v_can_continue,
    'terms', jsonb_build_object(
      'document_id', v_terms.id,
      'version', v_terms.version,
      'title', v_terms.title,
      'content_markdown', v_terms.content_markdown,
      'content_sha256', v_terms.content_sha256,
      'is_accepted', v_terms_accepted,
      'is_viewed', v_terms_viewed
    ),
    'privacy', jsonb_build_object(
      'document_id', v_privacy.id,
      'version', v_privacy.version,
      'title', v_privacy.title,
      'content_markdown', v_privacy.content_markdown,
      'content_sha256', v_privacy.content_sha256,
      'is_accepted', v_privacy_accepted,
      'is_viewed', v_privacy_viewed
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_legal_acceptance_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_legal_acceptance_status() TO authenticated;

-- 3.4 RPC: record_legal_document_view(_document_id uuid, _client_platform text)
CREATE OR REPLACE FUNCTION public.record_legal_document_view(
  _document_id uuid,
  _client_platform text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subject_id uuid;
  v_doc record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _client_platform NOT IN ('mobile_ios', 'mobile_android', 'admin_web') THEN
    RAISE EXCEPTION 'Invalid client platform: %', _client_platform USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, version, is_active INTO v_doc
  FROM public.legal_documents
  WHERE id = _document_id;

  IF NOT FOUND OR v_doc.is_active = false THEN
    RAISE EXCEPTION 'Legal document not found or inactive: %', _document_id USING ERRCODE = 'check_violation';
  END IF;

  v_subject_id := public.get_or_create_legal_subject_id(v_user_id);

  INSERT INTO public.legal_document_views (
    user_id, legal_subject_id, document_id, document_version, viewed_at, client_platform
  ) VALUES (
    v_user_id, v_subject_id, _document_id, v_doc.version, now(), _client_platform
  )
  ON CONFLICT (legal_subject_id, document_id) DO UPDATE
  SET viewed_at = now(),
      client_platform = EXCLUDED.client_platform,
      user_id = EXCLUDED.user_id;

  RETURN jsonb_build_object('success', true, 'viewed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.record_legal_document_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_legal_document_view(uuid, text) TO authenticated;

-- 3.5 RPC: accept_legal_documents(...)
CREATE OR REPLACE FUNCTION public.accept_legal_documents(
  _terms_document_id uuid,
  _privacy_document_id uuid,
  _client_platform text,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subject_id uuid;
  v_terms_doc record;
  v_privacy_doc record;
  v_terms_viewed boolean;
  v_privacy_viewed boolean;
  v_method text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _client_platform NOT IN ('mobile_ios', 'mobile_android', 'admin_web') THEN
    RAISE EXCEPTION 'Invalid client platform: %', _client_platform USING ERRCODE = 'check_violation';
  END IF;

  v_method := CASE WHEN _client_platform = 'admin_web' THEN 'admin_portal' ELSE 'in_app' END;

  SELECT id, version, content_sha256 INTO v_terms_doc
  FROM public.legal_documents
  WHERE id = _terms_document_id AND document_type = 'terms' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terms document is invalid or not active' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, version, content_sha256 INTO v_privacy_doc
  FROM public.legal_documents
  WHERE id = _privacy_document_id AND document_type = 'privacy' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Privacy document is invalid or not active' USING ERRCODE = 'check_violation';
  END IF;

  v_subject_id := public.get_or_create_legal_subject_id(v_user_id);

  -- Verification: Proof of Presentation / View
  SELECT EXISTS (
    SELECT 1 FROM public.legal_document_views
    WHERE legal_subject_id = v_subject_id AND document_id = _terms_document_id
  ) INTO v_terms_viewed;

  SELECT EXISTS (
    SELECT 1 FROM public.legal_document_views
    WHERE legal_subject_id = v_subject_id AND document_id = _privacy_document_id
  ) INTO v_privacy_viewed;

  IF NOT v_terms_viewed OR NOT v_privacy_viewed THEN
    RAISE EXCEPTION 'Both documents must be viewed in full before acceptance.' USING ERRCODE = 'check_violation';
  END IF;

  -- Persist Acceptances
  INSERT INTO public.legal_acceptances (
    user_id, legal_subject_id, document_id, document_type, document_version,
    content_sha256, accepted_at, acceptance_method, user_agent, client_platform
  ) VALUES
  (v_user_id, v_subject_id, v_terms_doc.id, 'terms', v_terms_doc.version,
   v_terms_doc.content_sha256, now(), v_method, _user_agent, _client_platform),
  (v_user_id, v_subject_id, v_privacy_doc.id, 'privacy', v_privacy_doc.version,
   v_privacy_doc.content_sha256, now(), v_method, _user_agent, _client_platform)
  ON CONFLICT (legal_subject_id, document_id) DO UPDATE
  SET accepted_at = now(),
      user_agent = EXCLUDED.user_agent,
      client_platform = EXCLUDED.client_platform,
      user_id = EXCLUDED.user_id;

  -- Audit log entry
  INSERT INTO public.logs (
    user_id,
    user_name,
    action,
    target_type,
    target_id,
    details,
    timestamp
  ) VALUES (
    v_user_id,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = v_user_id), 'User'),
    'accept_legal_documents',
    'legal_acceptance',
    v_subject_id::text,
    jsonb_build_object(
      'terms_document_id', _terms_document_id,
      'privacy_document_id', _privacy_document_id,
      'client_platform', _client_platform
    ),
    now()
  );

  RETURN jsonb_build_object('success', true, 'accepted_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.accept_legal_documents(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_legal_documents(uuid, uuid, text, text) TO authenticated;

-- 3.6 RPC: publish_legal_document_version(...)
CREATE OR REPLACE FUNCTION public.publish_legal_document_version(
  _document_type text,
  _version text,
  _title text,
  _content_markdown text,
  _effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sha256 text;
  v_doc_id uuid;
BEGIN
  IF NOT public.can_publish_legal_documents() THEN
    RAISE EXCEPTION 'Owner authorization required to publish legal documents'
      USING ERRCODE = '42501';
  END IF;

  IF _document_type NOT IN ('terms', 'privacy') THEN
    RAISE EXCEPTION 'Invalid document_type: %. Must be terms or privacy.', _document_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF length(trim(_version)) = 0 OR length(trim(_title)) = 0 OR length(trim(_content_markdown)) = 0 THEN
    RAISE EXCEPTION 'Version, title, and content_markdown cannot be empty.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Compute SHA-256
  v_sha256 := encode(sha256(_content_markdown::bytea), 'hex');

  -- Deactivate prior active version of same type
  UPDATE public.legal_documents
  SET is_active = false
  WHERE document_type = _document_type AND is_active = true;

  -- Insert new active published version
  INSERT INTO public.legal_documents (
    document_type,
    version,
    title,
    content_markdown,
    content_sha256,
    effective_at,
    is_active,
    is_published,
    published_at,
    published_by,
    created_by
  ) VALUES (
    _document_type,
    _version,
    _title,
    _content_markdown,
    v_sha256,
    COALESCE(_effective_at, now()),
    true,
    true,
    now(),
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO v_doc_id;

  -- Audit log entry
  INSERT INTO public.logs (
    user_id,
    user_name,
    action,
    target_type,
    target_id,
    details,
    timestamp
  ) VALUES (
    auth.uid(),
    COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Owner'),
    'publish_legal_document_version',
    'legal_document',
    v_doc_id::text,
    jsonb_build_object(
      'document_type', _document_type,
      'version', _version,
      'content_sha256', v_sha256
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'document_id', v_doc_id,
    'document_type', _document_type,
    'version', _version,
    'content_sha256', v_sha256,
    'published_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_legal_document_version(text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_legal_document_version(text, text, text, text, timestamptz) TO authenticated;

-- ====================================================================
-- 4. UPDATE process_account_deletion TO PRESERVE ANONYMIZED LEGAL AUDIT
-- ====================================================================
CREATE OR REPLACE FUNCTION public.process_account_deletion(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_request record;
  v_target record;
  v_blocking_reservations integer;
  v_blocking_payments integer;
  v_actor_profile record;
  v_actor_name text;
BEGIN
  -- 1. Capability Authorization
  IF NOT public.can_manage_customers() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators on approved devices can process account deletion.';
  END IF;

  -- 2. Lock & Validate Deletion Request
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deletion request not found.';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been processed.';
  END IF;

  -- 3. Lock & Validate Target Profile
  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target customer profile not found.';
  END IF;

  IF v_target.role <> 'customer' THEN
    RAISE EXCEPTION 'Target account is not a customer (role: %). Cannot process deletion through customer deletion pipeline.', v_target.role;
  END IF;

  -- 4. Check Outstanding Obligations
  SELECT count(*) INTO v_blocking_reservations
  FROM public.reservations r
  WHERE r.customer_id = v_request.user_id
    AND r.deleted = false
    AND lower(trim(r.status)) <> 'cancelled'
    AND r.balance_settled_at IS NULL
    AND (
      lower(trim(r.payment_status)) <> 'paid'
      OR
      (lower(trim(r.payment_type)) = 'deposit' AND r.rental_price > coalesce(r.deposit, 0))
    );

  SELECT count(*) INTO v_blocking_payments
  FROM public.payments
  WHERE user_id = v_request.user_id
    AND status IN ('awaiting_payment', 'processing');

  IF v_blocking_reservations > 0 OR v_blocking_payments > 0 THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'blocking_reservations', v_blocking_reservations,
      'blocking_payments', v_blocking_payments
    );
  END IF;

  -- 5. Irreversible Child Data Erasure
  DELETE FROM public.user_measurements WHERE user_id = v_request.user_id;
  DELETE FROM public.wishlists WHERE user_id = v_request.user_id;
  DELETE FROM public.wardrobe_items WHERE user_id = v_request.user_id;
  DELETE FROM public.saved_outfits WHERE user_id = v_request.user_id;
  DELETE FROM public.capsule_items
    WHERE capsule_id IN (SELECT id FROM public.capsules WHERE user_id = v_request.user_id);
  DELETE FROM public.capsules WHERE user_id = v_request.user_id;
  DELETE FROM public.notifications WHERE user_id = v_request.user_id;
  DELETE FROM public.stock_notify_requests WHERE user_id = v_request.user_id;
  DELETE FROM public.announcement_dismissals WHERE user_id = v_request.user_id;

  -- 6. Anonymize Business, Legal & Product Interest Records
  UPDATE public.logs SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.feedback SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.ar_sessions SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = v_request.user_id;
  UPDATE public.reviews SET user_id = NULL WHERE user_id = v_request.user_id;
  
  -- Sever user reference from legal audit tables while retaining pseudonymized legal_subject_id
  UPDATE public.legal_acceptances SET user_id = NULL WHERE user_id = v_request.user_id;
  UPDATE public.legal_document_views SET user_id = NULL WHERE user_id = v_request.user_id;
  DELETE FROM public.user_legal_subjects WHERE user_id = v_request.user_id;

  -- 7. Scrub the Profile Row
  UPDATE public.profiles
  SET
    first_name = NULL,
    last_name = NULL,
    email = NULL,
    phone = NULL,
    address_line = NULL,
    barangay = NULL,
    city = NULL,
    province = NULL,
    postal_code = NULL,
    avatar_url = NULL,
    deleted = true,
    updated_at = now()
  WHERE id = v_request.user_id;

  -- 8. Mark Deletion Request Completed
  UPDATE public.account_deletion_requests
  SET
    status = 'completed',
    processed_at = now(),
    processed_by = auth.uid()
  WHERE id = _request_id;

  -- 9. Audit Log
  SELECT * INTO v_actor_profile
  FROM public.profiles
  WHERE id = auth.uid();

  v_actor_name := coalesce(
    trim(v_actor_profile.first_name || ' ' || v_actor_profile.last_name),
    v_actor_profile.email,
    'Staff'
  );

  INSERT INTO public.logs (
    user_id,
    user_name,
    action,
    target_type,
    target_id,
    details,
    timestamp
  ) VALUES (
    auth.uid(),
    v_actor_name,
    'account_deletion_processed',
    'customer',
    v_request.user_id::text,
    jsonb_build_object(
      'request_id', _request_id,
      'reason', v_request.reason
    ),
    now()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;
