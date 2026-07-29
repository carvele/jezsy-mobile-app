-- Reverts 20260729090626_revoke_enforce_message_edit_scope.sql
--
-- Restores the PostgreSQL default of EXECUTE granted to PUBLIC.

GRANT EXECUTE ON FUNCTION public.enforce_message_edit_scope() TO PUBLIC;
