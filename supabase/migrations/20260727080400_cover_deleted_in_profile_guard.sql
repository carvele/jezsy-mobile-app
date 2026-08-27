-- Finding L-4. check_profile_updates() guards role, employment_status and
-- is_blocked, but not deleted. The profiles UPDATE policy is bare
-- auth.uid() = id with no WITH CHECK, so a user can currently set their own
-- profiles.deleted = true. Impact is self-harm only -- is_staff_or_admin()
-- requires deleted = false, so it self-locks rather than escalating -- but a
-- user silently soft-deleting themselves is not a state the app can recover
-- from in-product.
--
-- BLAST RADIUS: if the owner-dashboard has a self-service account-deletion
-- flow that sets deleted on the caller's own row, this will start raising.
-- Confirm before applying.

CREATE OR REPLACE FUNCTION public.check_profile_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  performer_role text;
BEGIN
  -- Only enforce when a privileged column is being changed
  IF (
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.employment_status IS DISTINCT FROM OLD.employment_status OR
    NEW.is_blocked IS DISTINCT FROM OLD.is_blocked OR
    NEW.deleted IS DISTINCT FROM OLD.deleted
  ) THEN
    -- Allow system / superuser operations (auth.uid() is NULL in those contexts)
    IF auth.uid() IS NOT NULL THEN
      -- Block self-modification of privileged columns
      IF auth.uid() = OLD.id THEN
        RAISE EXCEPTION 'You cannot modify your own role, employment status, block status, or deletion state.';
      END IF;

      -- Only owner or owner may touch these columns
      SELECT role INTO performer_role
      FROM public.profiles
      WHERE id = auth.uid() AND deleted = false;

      IF performer_role IS NULL OR performer_role NOT IN ('owner') THEN
        RAISE EXCEPTION 'Only administrators or owners can modify role, employment status, block status, or deletion state.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
