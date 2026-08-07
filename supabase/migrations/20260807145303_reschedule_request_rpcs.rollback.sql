-- Rollback: remove the request/approve pair and reopen the old direct path.
-- Reopening is deliberate: without it a customer has no way to reschedule at
-- all, which is worse than the unilateral change this replaced.
DROP FUNCTION IF EXISTS public.request_reschedule(uuid, text, text);
DROP FUNCTION IF EXISTS public.resolve_reschedule(uuid, boolean);

GRANT EXECUTE ON FUNCTION public.reschedule_reservation(uuid, text, text) TO authenticated;
