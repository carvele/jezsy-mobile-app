-- Migration: 20260920010000_customer_welcome_message.sql
-- Description:
-- 1. Seeds default welcomeMessage settings row with enabled = false (Option B: disabled by default).
-- 2. Adds partial unique index idx_messages_welcome_single_greeting on messages (conversation_id) WHERE sender_type = 'welcome'.
-- 3. Updates notify_customer_on_support_message() to suppress customer push notifications for sender_type = 'welcome'.
-- 4. Creates private canonical engine public.provision_customer_welcome(p_customer_id uuid) with:
--    - Customer eligibility validation (role = 'customer', deleted != true, is_blocked != true).
--    - Defensive settings parsing with fail-closed validation and migration fallback greeting text.
--    - Deterministic owner/admin support sender selection (role IN ('owner','admin'), deleted != true, is_blocked != true, employment_status = 'active' ORDER BY priority, created_at ASC, id ASC).
--    - Fail-safe no-owner handling (warning logged, zero mutation, signup succeeds).
--    - Conflict-safe conversation insertion (ON CONFLICT (customer_id) DO NOTHING).
--    - Row-level lock (FOR UPDATE on conversations) protecting against Race C (customer message collides with recovery).
--    - Invariant state machine (State A: welcome exists -> no-op; State B: prior support history -> no-op; State C: empty conversation -> welcome; State D: no conversation -> atomic conv + welcome).
--    - Conflict-safe message insertion using partial unique index.
-- 5. Hardens function execution permissions: revokes provision_customer_welcome from PUBLIC, anon, authenticated (service_role only).
-- 6. Creates public customer RPC public.ensure_my_welcome_conversation() (zero arguments, auth.uid() self-only derivation).
-- 7. Creates handle_profile_welcome_conversation() trigger function with narrow exception isolation and trigger trg_profile_welcome_conversation AFTER INSERT ON public.profiles.

-- 1. Ensure default settings row exists without overwriting existing configuration
INSERT INTO public.settings (key, value)
VALUES (
  'welcomeMessage',
  '{"enabled": false, "message": "Welcome to Jezsy Boutique Support! Let us know if you need sizing advice, styling assistance, or help with an order."}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 2. Create partial unique index on messages for exactly-once welcome greeting
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_welcome_single_greeting
ON public.messages (conversation_id)
WHERE (sender_type = 'welcome');

-- 3. Update support message notification trigger to suppress welcome push notifications
CREATE OR REPLACE FUNCTION public.notify_customer_on_support_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  -- Suppress automated responses and welcome greetings from push notifications
  IF coalesce(NEW.is_auto_response, false) = true
     OR coalesce(NEW.sender_type, '') IN ('auto_response', 'welcome') THEN
    RETURN NEW;
  END IF;

  -- Only genuine replies from boutique staff/admin/owner
  IF coalesce(NEW.sender_role, '') NOT IN ('staff', 'admin', 'owner') THEN
    RETURN NEW;
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_customer_id IS NOT NULL AND v_customer_id <> coalesce(NEW.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    PERFORM public.enqueue_customer_notification(
      _user_id => v_customer_id,
      _title   => 'New Message from Boutique Support',
      _body    => substring(coalesce(NEW.text, 'You have a new message from Boutique Support') from 1 for 120),
      _type    => 'conversation',
      _data    => jsonb_build_object(
        'entity_type', 'conversation',
        'entity_id', NEW.conversation_id,
        'action', 'new_message',
        'conversation_id', NEW.conversation_id,
        'actor_id', NEW.sender_id,
        'actor_name', coalesce(NEW.sender_name, 'Boutique Support'),
        'deep_link', '/messages/' || NEW.conversation_id
      ),
      _is_read => true -- Push transport row; is_read starts true to avoid duplicate badge
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Private Canonical Provisioning Engine
CREATE OR REPLACE FUNCTION public.provision_customer_welcome(p_customer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cust_role text;
  v_cust_deleted boolean;
  v_cust_blocked boolean;
  v_settings_value jsonb;
  v_setting_enabled boolean := false;
  v_welcome_message text := 'Welcome to Jezsy Boutique Support! Let us know if you need sizing advice, styling assistance, or help with an order.';
  v_extracted_msg text;
  v_support_sender_id uuid;
  v_conv_id uuid;
  v_has_welcome boolean;
  v_has_messages boolean;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 1: Customer Eligibility Validation
  SELECT role, coalesce(deleted, false), coalesce(is_blocked, false)
  INTO v_cust_role, v_cust_deleted, v_cust_blocked
  FROM public.profiles
  WHERE id = p_customer_id;

  IF NOT FOUND 
     OR v_cust_role <> 'customer' 
     OR v_cust_deleted IS TRUE 
     OR v_cust_blocked IS TRUE 
  THEN
    RETURN NULL;
  END IF;

  -- Step 2: Defensive Settings Parsing
  SELECT value INTO v_settings_value
  FROM public.settings
  WHERE key = 'welcomeMessage';

  IF FOUND AND v_settings_value IS NOT NULL AND jsonb_typeof(v_settings_value) = 'object' THEN
    -- Validate 'enabled' boolean flag
    IF jsonb_typeof(v_settings_value->'enabled') = 'boolean' THEN
      v_setting_enabled := (v_settings_value->>'enabled')::boolean;
    ELSE
      v_setting_enabled := false;
    END IF;

    -- Validate 'message' text string
    IF jsonb_typeof(v_settings_value->'message') = 'string' THEN
      v_extracted_msg := trim(v_settings_value->>'message');
      IF length(v_extracted_msg) > 0 AND length(v_extracted_msg) <= 2000 THEN
        v_welcome_message := v_extracted_msg;
      END IF;
    END IF;
  ELSE
    v_setting_enabled := false;
  END IF;

  -- Kill switch: if disabled or malformed, exit immediately with zero mutation
  IF NOT v_setting_enabled THEN
    RETURN NULL;
  END IF;

  -- Step 3: Deterministic Support Sender Selection (Owner / Admin only)
  SELECT id INTO v_support_sender_id
  FROM public.profiles
  WHERE role IN ('owner', 'admin')
    AND coalesce(deleted, false) = false
    AND coalesce(is_blocked, false) = false
    AND coalesce(employment_status, 'active') = 'active'
  ORDER BY 
    CASE 
      WHEN role = 'owner' THEN 1 
      WHEN role = 'admin' THEN 2 
      ELSE 3 
    END,
    created_at ASC,
    id ASC
  LIMIT 1;

  IF v_support_sender_id IS NULL THEN
    RAISE WARNING 'Welcome message skipped: no active owner/admin identity found for customer %', p_customer_id;
    RETURN NULL;
  END IF;

  -- Step 4: Conflict-Safe Conversation Ensure
  INSERT INTO public.conversations (customer_id, unread_customer, unread_staff)
  VALUES (p_customer_id, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  -- Step 5: Acquire row-level lock on the conversation to protect against Race C
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF v_conv_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 6: Evaluate Message Existence Under Conversation Lock
  SELECT 
    EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = v_conv_id AND sender_type = 'welcome'),
    EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = v_conv_id)
  INTO v_has_welcome, v_has_messages;

  -- State A: Welcome already exists -> NO-OP
  -- State B: Genuine prior messages exist and no welcome -> NO-OP (never pollute active support history)
  IF v_has_welcome OR v_has_messages THEN
    RETURN v_conv_id;
  END IF;

  -- Step 7: State C / State D - Insert Welcome Message
  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    sender_name,
    text,
    sender_type,
    is_auto_response
  ) VALUES (
    v_conv_id,
    v_support_sender_id,
    'Boutique Support',
    v_welcome_message,
    'welcome',
    false
  )
  ON CONFLICT (conversation_id) WHERE (sender_type = 'welcome') DO NOTHING;

  RETURN v_conv_id;
END;
$$;

-- 5. Lock down private provisioning engine
REVOKE ALL ON FUNCTION public.provision_customer_welcome(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_customer_welcome(uuid) TO service_role;

-- 6. Public Self-Service Customer RPC (zero arguments, derives auth.uid() internally)
CREATE OR REPLACE FUNCTION public.ensure_my_welcome_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN public.provision_customer_welcome(v_caller_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_welcome_conversation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_welcome_conversation() TO authenticated, service_role;

-- 7. Profile Signup Trigger Function & Trigger with Narrow Exception Isolation
CREATE OR REPLACE FUNCTION public.handle_profile_welcome_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'customer' THEN
    BEGIN
      PERFORM public.provision_customer_welcome(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Welcome message provisioning failed for customer %: % (SQLSTATE %)',
        NEW.id, SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_profile_welcome_conversation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_profile_welcome_conversation() TO service_role;

DROP TRIGGER IF EXISTS trg_profile_welcome_conversation ON public.profiles;
CREATE TRIGGER trg_profile_welcome_conversation
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_welcome_conversation();
