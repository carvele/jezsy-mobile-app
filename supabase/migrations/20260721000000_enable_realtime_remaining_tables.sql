-- Reconstructed from live DB state to restore the file<->ledger 1:1 invariant.
-- Applied directly to the live project by a teammate; this file captures the
-- confirmed current supabase_realtime publication membership rather than the
-- original exact statements (which weren't available to reconstruct).
-- See docs/DB_IMPLEMENTATION_PLAN.md for the shared-migration-ledger context.

do $$
declare
  t text;
begin
  foreach t in array array[
    'ar_assets', 'ar_sessions', 'categories', 'conversations', 'devices',
    'feedback', 'inventory', 'messages', 'notifications', 'pose_guides',
    'products', 'profiles', 'reservations', 'suggested_outfits', 'wardrobe_items'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
