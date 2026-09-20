-- Makes the verified Auth phone identity the canonical mobile-login identifier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (phone)
  WHERE phone IS NOT NULL AND pg_catalog.btrim(phone) <> '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, first_name, last_name, role, created_at, updated_at
  ) VALUES (
    NEW.id,
    pg_catalog.lower(NEW.email),
    pg_catalog.nullif(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'first_name'), ''),
    pg_catalog.nullif(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'last_name'), ''),
    'customer',
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_phone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET phone = NEW.phone,
      updated_at = pg_catalog.now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_user_phone_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_phone_changed ON auth.users;
CREATE TRIGGER on_auth_user_phone_changed
AFTER UPDATE OF phone ON auth.users
FOR EACH ROW
WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
EXECUTE FUNCTION public.handle_user_phone_change();
