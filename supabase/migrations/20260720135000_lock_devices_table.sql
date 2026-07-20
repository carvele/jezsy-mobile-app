-- Migration: Remove the devices table's true/true RLS policy
--
-- public.devices had one policy: "Enable upsert for authenticated users",
-- FOR ALL USING (true) WITH CHECK (true) for role authenticated. devices is
-- the admin dashboard's device-approval gate (fingerprint, status,
-- failed_attempts, lockout_until, login_history, staff emails/names). Any
-- customer signed in through the mobile app could read every staff device
-- record, approve any device, clear lockouts, or delete rows.
--
-- Verified before writing this migration: admin-dashboard's
-- AuthContext.jsx calls registerDevice()/handleDeviceCheck(supabaseUser)
-- after supabase.auth.signInWithPassword() succeeds (handleDeviceCheck takes
-- the already-authenticated user as its argument). Device registration runs
-- on an authenticated session, so gating devices to staff/admin does not
-- block login or device registration for legitimate staff.
--
-- is_staff_or_admin() already exists (used elsewhere) and includes staff,
-- unlike is_admin_or_owner().

DROP POLICY IF EXISTS "Enable upsert for authenticated users" ON public.devices;

CREATE POLICY "Enable all access for staff or admin"
  ON public.devices
  FOR ALL
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());
