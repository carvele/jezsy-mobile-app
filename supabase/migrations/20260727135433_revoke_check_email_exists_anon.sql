-- Finding M-1 (2026-07-23 backend audit), and the server half of the auth
-- enumeration fix in 3ad5b11.
--
-- check_email_exists() is SECURITY DEFINER over auth.users and returns whether
-- an address is registered. It is reachable unauthenticated and unthrottled at
-- /rest/v1/rpc/check_email_exists, so removing the client-side pre-checks did
-- not close enumeration on its own -- an attacker never needed the UI.
--
-- The mobile app no longer calls this function anywhere (verified: zero
-- references under app/ after 3ad5b11), so revoking anon costs it nothing.
--
-- Deliberately NOT revoked from authenticated: the admin-dashboard repo may
-- call this from a signed-in staff context. Revoking anon closes the
-- unauthenticated vector, which is the one that matters; enumerating from a
-- signed-in account is attributable and rate-limitable.
--
-- REVOKE FROM anon alone is a no-op here -- EXECUTE is granted to PUBLIC by
-- default and anon inherits it. Revoke PUBLIC, then restore authenticated.
-- Verify with has_function_privilege afterwards, not by reading the grant.
--
-- BLAST RADIUS: breaks any anon (logged-out) caller in admin-dashboard.
-- Confirm with its owner before applying.

REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO authenticated;
