-- RECONSTRUCTED MIGRATION -- migration-ledger repair, 2026-07-20
--
-- Exists live (ledger version 20260719150000, name restrict_staff_write_rls)
-- with no file in this repo. Reconstructed from the live "Enable all access
-- for admin/staff" policy pattern (USING/WITH CHECK is_staff_or_admin(), TO
-- authenticated), confirmed present today on: inventory, settings, devices.
-- This is the same policy this repair discovered already covering devices
-- alongside the true/true policy removed by
-- 20260720135000_lock_devices_table.sql.
--
-- Idempotent (IF NOT EXISTS per table) so safe to leave in the history even
-- though the live state already reflects it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.inventory'::regclass AND polname='Enable all access for admin/staff') THEN
    CREATE POLICY "Enable all access for admin/staff" ON public.inventory FOR ALL TO authenticated USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.settings'::regclass AND polname='Enable all access for admin/staff') THEN
    CREATE POLICY "Enable all access for admin/staff" ON public.settings FOR ALL TO authenticated USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.devices'::regclass AND polname='Enable all access for admin/staff') THEN
    CREATE POLICY "Enable all access for admin/staff" ON public.devices FOR ALL TO authenticated USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
  END IF;
END $$;
