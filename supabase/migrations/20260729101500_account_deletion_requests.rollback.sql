-- Reverts 20260729101500_account_deletion_requests.sql
--
-- Drops the queue outright. Any pending requests go with it, so check for
-- unprocessed rows before running this.

DROP POLICY IF EXISTS "Staff manage deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users withdraw own pending deletion request" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users file own deletion request" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users read own deletion requests" ON public.account_deletion_requests;

DROP INDEX IF EXISTS public.account_deletion_requests_one_open;
DROP TABLE IF EXISTS public.account_deletion_requests;
