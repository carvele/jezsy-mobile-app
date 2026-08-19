-- Keep the account deletion recovery state unique per user while auth
-- revocation is still pending. This prevents a second request from being
-- filed after database scrubbing succeeded but auth deletion failed.
DROP INDEX IF EXISTS public.account_deletion_requests_one_open;
CREATE UNIQUE INDEX account_deletion_requests_one_open
  ON public.account_deletion_requests (user_id)
  WHERE status IN ('pending', 'auth_revocation_pending');
