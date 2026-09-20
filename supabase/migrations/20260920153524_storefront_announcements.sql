-- Unify mobile Inbox broadcasts and Home storefront campaigns under the
-- existing announcements workflow. Full-access roles in the Admin UI are
-- owner and admin, so the database helper must express the same boundary.

CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  user_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted = false
    AND is_blocked = false
    AND coalesce(employment_status, 'active') = 'active';

  RETURN coalesce(lower(user_role) IN ('owner', 'admin'), false);
END;
$function$;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'inbox',
  ADD COLUMN IF NOT EXISTS storefront_image_url text,
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_target_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cta_target_value text;

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_placement_check,
  ADD CONSTRAINT announcements_placement_check
    CHECK (placement IN ('inbox', 'storefront', 'both')),
  DROP CONSTRAINT IF EXISTS announcements_cta_target_type_check,
  ADD CONSTRAINT announcements_cta_target_type_check
    CHECK (cta_target_type IN ('none', 'category', 'product', 'catalog'));

CREATE INDEX IF NOT EXISTS idx_announcements_storefront_active
  ON public.announcements (created_at DESC)
  WHERE placement IN ('storefront', 'both');

DROP POLICY IF EXISTS "Owner can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner can delete announcements" ON public.announcements;
DROP POLICY IF EXISTS "Owner manages announcements" ON public.announcements;

CREATE POLICY "Admin or owner can insert announcements"
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Admin or owner can update announcements"
  ON public.announcements FOR UPDATE TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Admin or owner can delete announcements"
  ON public.announcements FOR DELETE TO authenticated
  USING (public.is_admin_or_owner());
