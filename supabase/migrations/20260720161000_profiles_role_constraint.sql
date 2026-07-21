-- Migration: Constrain profiles.role
--
-- role is nullable free text with no CHECK, yet every RLS privilege helper
-- (is_admin_or_owner, is_staff_or_admin) reads it. The admin repo's own
-- fix_rls_role_casing migration proves a miscased role value already broke
-- RLS once. employment_status on this same table already has a CHECK; role
-- -- the column everything else depends on -- did not.
--
-- Live data verified before writing this migration: current distinct values
-- are exactly 'admin', 'customer', 'staff'. 'owner' is included in the CHECK
-- because is_admin_or_owner()/is_staff_or_admin() both test for it, even
-- though no profile currently holds it.

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'customer',
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'staff', 'admin', 'owner'));
