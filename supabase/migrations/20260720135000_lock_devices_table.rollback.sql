-- Rollback for 20260720150000_lock_devices_table.sql

DROP POLICY IF EXISTS "Enable all access for staff or admin" ON public.devices;

CREATE POLICY "Enable upsert for authenticated users"
  ON public.devices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
