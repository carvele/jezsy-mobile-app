select cron.unschedule('dispatch-pending-push');

drop function if exists public.dispatch_pending_push();

drop index if exists notifications_pending_push_idx;

alter table notifications drop column if exists pushed_at;

-- pg_net is left installed: dropping an extension another feature may have
-- started using is not a safe rollback step.
