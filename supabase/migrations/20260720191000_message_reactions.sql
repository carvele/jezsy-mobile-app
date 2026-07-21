-- Migration: Add storage and RPC for message reactions
--
-- admin-dashboard's Messages.jsx has a working, wired-up emoji-reaction UI
-- (addReaction() in communicationService.js, called from a real reaction
-- button) that calls supabase.rpc('merge_message_reaction', ...). That
-- function has never existed; every reaction click today silently no-ops
-- (a console.warn, per addReaction's own fallback comment which was never
-- implemented). messages also has no reactions column, so the feature has
-- no storage.
--
-- Decision: build the missing piece rather than remove the UI. The feature
-- is already built and staff-facing, not dead code; mobile has no reaction
-- UI (verified by repo search), so this is purely additive for admin.
--
-- Authorization: no bespoke check is added here. messages already has an
-- UPDATE policy ("Users can update their messages or mark as read") scoped
-- to conversation participants (customer or admin/owner), which is exactly
-- the right scope for "can react to a message in this conversation" --
-- SECURITY INVOKER rides on that existing policy instead of duplicating it.
--
-- p_user_id is text, not auth.uid(), to match admin's actual call site
-- (user?.uid || 'admin') -- it is a display label into the reactions map,
-- not a permission check; permission is enforced by the UPDATE policy on
-- the table itself.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.merge_message_reaction(
  p_message_id uuid,
  p_user_id text,
  p_emoji text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current jsonb;
  v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'p_user_id is required.';
  END IF;
  IF p_emoji IS NULL OR p_emoji = '' THEN
    RAISE EXCEPTION 'p_emoji is required.';
  END IF;

  SELECT reactions INTO v_current FROM public.messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found.';
  END IF;

  v_current := coalesce(v_current, '{}'::jsonb);

  IF v_current ->> p_user_id = p_emoji THEN
    v_result := v_current - p_user_id;
  ELSE
    v_result := v_current || jsonb_build_object(p_user_id, p_emoji);
  END IF;

  UPDATE public.messages SET reactions = v_result WHERE id = p_message_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) TO authenticated;
