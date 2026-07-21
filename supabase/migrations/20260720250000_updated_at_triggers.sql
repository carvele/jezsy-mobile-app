-- Migration: Maintain updated_at server-side
--
-- DB_TABLE_AUDIT_2026-07-20.md cross-cutting finding 2: updated_at exists on
-- ~half the tables and was maintained by zero triggers -- every value was
-- client-supplied or frozen at the default, so the column could not be
-- trusted for "when did this row last change".
--
-- EXCLUSIONS (deliberate):
--   * stock_movements -- has a CHECK (updated_at = created_at) enforcing
--     immutability plus a prevent_stock_movement_updates trigger. A touch
--     trigger would fight both. Its updated_at is intentionally frozen.
--   * pose_guides, suggested_outfits -- candidate dead tables pending the
--     drop/keep decision; not worth wiring triggers onto something that may
--     be dropped.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'ar_assets', 'capsules', 'color_list', 'conversations', 'devices',
    'inventory', 'pattern_list', 'products', 'profiles', 'reservations',
    'settings', 'user_streaks'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t
    );
  END LOOP;
END $$;
