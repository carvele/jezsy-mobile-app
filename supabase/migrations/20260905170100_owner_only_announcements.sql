-- 20260729013246_announcements.sql's own comment calls this "owner-broadcast
-- announcements," but the policy it wrote actually used is_staff_or_admin(),
-- letting any staff account write announcements -- not just Owner. The
-- admin-dashboard UI (Broadcast button) restricts this to Owner-only, so the
-- UI and DB now disagree. Tighten the DB to match the documented intent.

DROP POLICY IF EXISTS "Staff manage announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner manages announcements" ON public.announcements;
CREATE POLICY "Owner manages announcements" ON public.announcements FOR ALL TO authenticated
USING (public.is_admin_or_owner())
WITH CHECK (public.is_admin_or_owner());
