-- Finding L-6, follow-up. 20260728015951 swept the trigger functions reachable
-- via /rest/v1/rpc/ but missed enforce_message_edit_scope, which is still
-- EXECUTE-able by anon and authenticated through the PUBLIC default grant.
--
-- It is SECURITY INVOKER and errors outside a trigger context, so impact is
-- low, but it is not part of the public API.
--
-- REVOKE FROM anon alone is a no-op; revoke PUBLIC explicitly and verify with
-- has_function_privilege.

REVOKE EXECUTE ON FUNCTION public.enforce_message_edit_scope() FROM PUBLIC, anon, authenticated;
