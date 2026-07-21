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
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.touch_updated_at();
