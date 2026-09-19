-- Records explicit sign-up consent after OTP verification.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version text;

CREATE OR REPLACE FUNCTION public.record_signup_legal_acceptance(
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
  v_accepted_at timestamptz := pg_catalog.now();
  v_terms_accepted_at timestamptz;
  v_privacy_accepted_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF _client_platform NOT IN ('mobile_ios', 'mobile_android', 'admin_web') THEN
    RAISE EXCEPTION 'Invalid client platform: %', _client_platform USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, version, content_sha256
  INTO v_terms_doc
  FROM public.legal_documents
  WHERE document_type = 'terms' AND is_active = true
  LIMIT 1;

  SELECT id, version, content_sha256
  INTO v_privacy_doc
  FROM public.legal_documents
  WHERE document_type = 'privacy' AND is_active = true
  LIMIT 1;

  -- Keep accounts usable until both documents are published.
  IF v_terms_doc.id IS NULL OR v_privacy_doc.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'gate_enabled', false);
  END IF;

  v_subject_id := public.get_or_create_legal_subject_id(v_user_id);

  INSERT INTO public.legal_acceptances (
    user_id, legal_subject_id, document_id, document_type, document_version,
    content_sha256, accepted_at, acceptance_method, user_agent, client_platform
  ) VALUES
  (v_user_id, v_subject_id, v_terms_doc.id, 'terms', v_terms_doc.version,
   v_terms_doc.content_sha256, v_accepted_at, 'in_app', _user_agent, _client_platform),
  (v_user_id, v_subject_id, v_privacy_doc.id, 'privacy', v_privacy_doc.version,
   v_privacy_doc.content_sha256, v_accepted_at, 'in_app', _user_agent, _client_platform)
  ON CONFLICT (legal_subject_id, document_id) DO NOTHING;

  SELECT accepted_at INTO v_terms_accepted_at
  FROM public.legal_acceptances
  WHERE legal_subject_id = v_subject_id AND document_id = v_terms_doc.id;

  SELECT accepted_at INTO v_privacy_accepted_at
  FROM public.legal_acceptances
  WHERE legal_subject_id = v_subject_id AND document_id = v_privacy_doc.id;

  UPDATE public.profiles
  SET terms_accepted_at = v_terms_accepted_at,
      terms_version = v_terms_doc.version,
      privacy_accepted_at = v_privacy_accepted_at,
      privacy_version = v_privacy_doc.version,
      updated_at = v_accepted_at
  WHERE id = v_user_id;

  INSERT INTO public.logs (
    user_id, user_name, action, target_type, target_id, details, timestamp
  ) VALUES (
    v_user_id,
    pg_catalog.coalesce((SELECT full_name FROM public.profiles WHERE id = v_user_id), 'User'),
    'record_signup_legal_acceptance',
    'legal_acceptance',
    v_subject_id::text,
    pg_catalog.jsonb_build_object(
      'terms_document_id', v_terms_doc.id,
      'terms_version', v_terms_doc.version,
      'privacy_document_id', v_privacy_doc.id,
      'privacy_version', v_privacy_doc.version,
      'client_platform', _client_platform
    ),
    v_accepted_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'gate_enabled', true,
    'terms_accepted_at', v_terms_accepted_at,
    'terms_version', v_terms_doc.version,
    'privacy_accepted_at', v_privacy_accepted_at,
    'privacy_version', v_privacy_doc.version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_signup_legal_acceptance(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_legal_acceptance(text, text) TO authenticated;
