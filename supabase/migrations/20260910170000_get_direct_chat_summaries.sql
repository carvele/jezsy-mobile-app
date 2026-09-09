-- Returns paginated direct chat summaries strictly scoped to the authenticated caller.
CREATE OR REPLACE FUNCTION public.get_direct_chat_summaries(
  p_limit int DEFAULT 31,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  chat_id uuid,
  other_user_id uuid,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    dc.id AS chat_id,
    dcp2.user_id AS other_user_id,
    dc.updated_at
  FROM direct_chat_participants dcp1
  JOIN direct_chats dc ON dc.id = dcp1.chat_id
  JOIN direct_chat_participants dcp2 ON dcp2.chat_id = dc.id AND dcp2.user_id <> auth.uid()
  WHERE dcp1.user_id = auth.uid()
  ORDER BY dc.updated_at DESC, dc.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 31), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_direct_chat_summaries(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_direct_chat_summaries(int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_direct_chat_summaries(int, int) TO authenticated;
