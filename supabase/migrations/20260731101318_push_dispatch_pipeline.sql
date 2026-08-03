-- Restores the outbound notification channel.
--
-- notify_reservation_status_change and notify_stock_back_in_stock already
-- INSERT well-formed rows into notifications, but nothing ever delivered them
-- to a device: the only code calling Expo's push API lived in the
-- notify-status edge function, which was never deployed (and branched on the
-- dropped orders table). Notifications were in-app only -- visible solely if
-- the customer happened to open the app -- while the expire-unpaid-reservations
-- cron silently cancelled reservations after the 120-minute payment window.
--
-- Expo's push API authenticates with the push token itself, so Postgres can
-- POST directly via pg_net. That avoids storing a service-role key in the DB
-- or in a cron command, and needs no edge function or Database Webhook.

create extension if not exists pg_net;

alter table notifications add column if not exists pushed_at timestamptz;

comment on column notifications.pushed_at is
  'When the row was handed to Expo. NULL means pending dispatch.';

-- Partial index: the dispatcher only ever scans pending rows.
create index if not exists notifications_pending_push_idx
  on notifications (created_at)
  where pushed_at is null;

-- Existing rows predate the dispatcher; mark them delivered so enabling this
-- does not blast a backlog of stale status changes at anyone.
update notifications set pushed_at = now() where pushed_at is null;

create or replace function public.dispatch_pending_push()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sent integer := 0;
  r record;
begin
  for r in
    select n.id, n.title, n.body, n.data, p.expo_push_token
    from public.notifications n
    join public.profiles p on p.id = n.user_id
    where n.pushed_at is null
      and p.expo_push_token is not null
      -- Never push a stale status change; the in-app row still stands.
      and n.created_at > now() - interval '1 day'
    order by n.created_at
    limit 100
  loop
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'to', r.expo_push_token,
        'sound', 'default',
        'title', r.title,
        'body', r.body,
        'data', coalesce(r.data, '{}'::jsonb)
      )
    );
    v_sent := v_sent + 1;
  end loop;

  -- Marked in one pass rather than per row: pg_net is fire-and-forget, so
  -- delivery cannot be confirmed synchronously either way. At-most-once is
  -- the deliberate trade -- a duplicate push is worse than a missed one,
  -- and the in-app notifications row is always the durable record.
  update public.notifications n
  set pushed_at = now()
  from public.profiles p
  where p.id = n.user_id
    and n.pushed_at is null
    and p.expo_push_token is not null
    and n.created_at > now() - interval '1 day';

  return v_sent;
end;
$$;

-- Dispatcher is cron-only. REVOKE FROM anon alone would no-op here: EXECUTE
-- is granted to PUBLIC by default, so PUBLIC is the one that matters.
revoke all on function public.dispatch_pending_push() from public;
revoke all on function public.dispatch_pending_push() from anon, authenticated;

-- Every minute: fast enough for a 120-minute payment window, cheap at this
-- volume. Upserts by job name, so re-applying is safe.
select cron.schedule(
  'dispatch-pending-push',
  '* * * * *',
  'SELECT public.dispatch_pending_push();'
);
