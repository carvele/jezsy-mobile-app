-- Migration: Enable Realtime for tables missing it
--
-- 20260715100000_messaging_realtime.sql added `messages` and `conversations`
-- to the supabase_realtime publication, but no migration ever did the same
-- for the rest of the schema. admin-dashboard's subscribeToCollection /
-- subscribeToDocument (src/lib/supabaseService.js) already do an initial
-- fetch and then re-fetch on every `postgres_changes` event -- that part is
-- correct -- but Postgres only emits those events for tables in the
-- publication. Every other table silently never fires one, so writes (e.g.
-- cancelling a reservation) only show up in the UI after a manual reload.
--
-- Tables below are every one currently read via subscribeToCollection /
-- subscribeToDocument in admin-dashboard/src (Reservations, Analytics,
-- Customers, StaffManagement, DeviceManagement, catalog/Inventory, the
-- Sidebar low-stock badge, feedback, notifications, and the wardrobe pages).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reservations',
    'products',
    'inventory',
    'profiles',
    'categories',
    'feedback',
    'devices',
    'notifications',
    'suggested_outfits',
    'wardrobe_items',
    'ar_sessions',
    'ar_assets',
    'pose_guides'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END
$$;
