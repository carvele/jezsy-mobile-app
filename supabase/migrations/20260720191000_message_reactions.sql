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
