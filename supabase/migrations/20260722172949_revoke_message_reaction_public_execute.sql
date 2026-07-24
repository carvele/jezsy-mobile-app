-- Follow-up to 20260722172749_scope_message_updates.sql: after revoking
-- EXECUTE on merge_message_reaction() from `anon` directly, a live check
-- showed anon could still call it (has_function_privilege still true).
-- Cause: Postgres grants EXECUTE to PUBLIC by default at function creation
-- time, and 20260720191000_message_reactions.sql only ever revoked from
-- `anon`, never from PUBLIC -- so anon inherited EXECUTE through PUBLIC
-- regardless of the direct per-role revoke. This closes that properly.

REVOKE EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_message_reaction(uuid, text, text) TO authenticated;
