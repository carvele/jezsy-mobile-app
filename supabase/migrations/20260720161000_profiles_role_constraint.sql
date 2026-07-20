ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'customer',
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'staff', 'admin', 'owner'));
