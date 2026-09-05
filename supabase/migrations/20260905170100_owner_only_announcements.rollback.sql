DROP POLICY IF EXISTS "Owner manages announcements" ON public.announcements;
CREATE POLICY "Staff manage announcements" ON public.announcements FOR ALL TO authenticated
USING (public.is_staff_or_admin())
WITH CHECK (public.is_staff_or_admin());
