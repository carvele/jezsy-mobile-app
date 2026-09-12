-- Migration: Message mutation hardening (M1)
-- 1. Restrict direct client UPDATE privileges to messages.text only.
-- 2. Replace generic UPDATE policy with sender-only UPDATE RLS using (select auth.uid()).
-- 3. Trigger enforce_message_immutability_and_edit_scope protects immutable metadata and auto-stamps edited_at.
-- 4. Dedicated SECURITY DEFINER RPC mark_support_conversation_read for side-aware read acknowledgment.
-- 5. Dedicated SECURITY DEFINER RPC mark_support_messages_delivered for delivery stamping.
-- 6. Harden merge_message_reaction to SECURITY DEFINER with strict participant check and authenticated actor binding.

-- Column-level privilege allowlisting
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (text) ON public.messages TO authenticated;

-- Replace UPDATE RLS policy
DROP POLICY IF EXISTS "Users can update their messages or mark as read" ON public.messages;
DROP POLICY IF EXISTS "Senders can edit their own message text" ON public.messages;

CREATE POLICY "Senders can edit their own message text"
ON public.messages FOR UPDATE TO authenticated
USING (sender_id = (SELECT auth.uid()))
WITH CHECK (sender_id = (SELECT auth.uid()));

-- Hardened immutability & DB-owned edited_at trigger
CREATE OR REPLACE FUNCTION public.enforce_message_immutability_and_edit_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Immutable metadata guard
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.context_type IS DISTINCT FROM OLD.context_type
     OR NEW.context_ref IS DISTINCT FROM OLD.context_ref
     OR NEW.context_label IS DISTINCT FROM OLD.context_label
     OR NEW.image_url IS DISTINCT FROM OLD.image_url
     OR NEW.is_auto_response IS DISTINCT FROM OLD.is_auto_response
  THEN
    RAISE EXCEPTION 'Immutable message metadata cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  -- DB-owned edited_at stamping
  IF NEW.text IS DISTINCT FROM OLD.text THEN
    NEW.edited_at := now();
  ELSE
    NEW.edited_at := OLD.edited_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_message_immutability_and_edit_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_message_edit_scope ON public.messages;
DROP TRIGGER IF EXISTS trg_enforce_message_immutability_and_edit_scope ON public.messages;

CREATE TRIGGER trg_enforce_message_immutability_and_edit_scope
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_immutability_and_edit_scope();

-- Dedicated side-aware read transition RPC
CREATE OR REPLACE FUNCTION public.mark_support_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_caller_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_customer_id = v_caller_id THEN
    -- Customer caller: reset customer unread and mark staff/system messages read
    UPDATE public.conversations
    SET unread_customer = 0
    WHERE id = p_conversation_id;

    UPDATE public.messages
    SET delivered_at = COALESCE(delivered_at, now()),
        read_at = now()
    WHERE conversation_id = p_conversation_id
      AND (sender_id IS NULL OR sender_id != v_customer_id)
      AND read_at IS NULL;
  ELSIF public.is_staff_or_admin() THEN
    -- Staff caller: reset staff unread and mark customer messages read (never fellow staff)
    UPDATE public.conversations
    SET unread_staff = 0
    WHERE id = p_conversation_id;

    UPDATE public.messages
    SET delivered_at = COALESCE(delivered_at, now()),
        read_at = now()
    WHERE conversation_id = p_conversation_id
      AND sender_id = v_customer_id
      AND read_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_support_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_support_conversation_read(uuid) TO authenticated;

-- Dedicated delivery stamping RPC
CREATE OR REPLACE FUNCTION public.mark_support_messages_delivered(
  p_conversation_id uuid DEFAULT NULL,
  p_message_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_caller_id uuid;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer_id
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Conversation not found';
    END IF;

    IF v_customer_id = v_caller_id THEN
      UPDATE public.messages
      SET delivered_at = COALESCE(delivered_at, now())
      WHERE conversation_id = p_conversation_id
        AND (sender_id IS NULL OR sender_id != v_customer_id)
        AND delivered_at IS NULL
        AND (p_message_ids IS NULL OR id = ANY(p_message_ids));
    ELSIF public.is_staff_or_admin() THEN
      UPDATE public.messages
      SET delivered_at = COALESCE(delivered_at, now())
      WHERE conversation_id = p_conversation_id
        AND sender_id = v_customer_id
        AND delivered_at IS NULL
        AND (p_message_ids IS NULL OR id = ANY(p_message_ids));
    ELSE
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF p_message_ids IS NOT NULL AND array_length(p_message_ids, 1) > 0 THEN
    -- Flexible fallback for callers passing only messageIds
    IF public.is_staff_or_admin() THEN
      UPDATE public.messages m
      SET delivered_at = COALESCE(m.delivered_at, now())
      FROM public.conversations c
      WHERE m.id = ANY(p_message_ids)
        AND m.conversation_id = c.id
        AND m.sender_id = c.customer_id
        AND m.delivered_at IS NULL;
    ELSE
      UPDATE public.messages m
      SET delivered_at = COALESCE(m.delivered_at, now())
      WHERE m.id = ANY(p_message_ids)
        AND (m.sender_id IS NULL OR m.sender_id != v_caller_id)
        AND m.delivered_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.id = m.conversation_id AND c.customer_id = v_caller_id
        );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_support_messages_delivered(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_support_messages_delivered(uuid, uuid[]) TO authenticated;

-- Hardened reaction RPC
CREATE OR REPLACE FUNCTION public.merge_message_reaction(
  p_message_id uuid,
  p_user_id text,
  p_emoji text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current jsonb;
  v_result jsonb;
  v_actor_id text;
BEGIN
  IF p_emoji IS NULL OR p_emoji = '' THEN
    RAISE EXCEPTION 'p_emoji is required.';
  END IF;

  v_actor_id := (SELECT auth.uid())::text;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Anti-spoofing check
  IF p_user_id IS NOT NULL AND p_user_id != 'owner' AND p_user_id != v_actor_id THEN
    RAISE EXCEPTION 'Cannot react on behalf of another user' USING ERRCODE = '42501';
  END IF;

  -- Participant membership authorization check
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = p_message_id
      AND (c.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
  ) THEN
    RAISE EXCEPTION 'Message not found or unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT reactions INTO v_current FROM public.messages WHERE id = p_message_id;
  v_current := coalesce(v_current, '{}'::jsonb);

  IF v_current ->> v_actor_id = p_emoji THEN
    v_result := v_current - v_actor_id;
  ELSE
    v_result := v_current || jsonb_build_object(v_actor_id, p_emoji);
  END IF;

  UPDATE public.messages SET reactions = v_result WHERE id = p_message_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) TO authenticated;
