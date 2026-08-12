-- Applies three migrations that were merged into their respective repos'
-- own migration files but never actually reached the live database
-- (confirmed absent from the migration ledger and from the live schema for
-- all three), while the app code that depends on them already shipped.
--
-- 1. update_staff_role RPC (admin-dashboard/supabase/migrations/
--    20260810000001_add_update_staff_role_rpc.sql). StaffManagement.jsx
--    calls this by name -- the admin role-management UI has been broken
--    ("function does not exist") since it merged.
--
--    Hardened relative to the original: that version restricted callers to
--    caller_role IN ('owner') via a raw query checking only `deleted`.
--    Two problems. First, the same is_blocked/employment_status gap
--    is_staff_or_admin()/is_admin_or_owner() were hardened to close (audit
--    finding F3). Second, and more fundamental: no profile in this database
--    has role='owner' at all -- confirmed live, only 'staff'/'admin'/
--    'customer' exist. The admin app's own permission matrix
--    (src/utils/permissions.js: FULL = [OWNER, ADMIN]) and
--    is_admin_or_owner() both already treat 'admin' and 'owner' as the same
--    full-access tier. As originally written, this function would have
--    rejected every real user in the database, including the actual owner.
--    Uses is_admin_or_owner() directly instead of a duplicated raw check.
--
-- 2. pose_guides extended columns + pose_guide_products junction table
--    (20260810161500_extend_pose_guides_style_gallery.sql +
--    the pose_guides portion of
--    20260812231500_add_sender_role_and_fix_pose_guides.sql). The mobile
--    app's Style Pose gallery (app/style-pose/[id].tsx, StyleGallery.tsx)
--    already shipped querying these; it degrades silently rather than
--    erroring (select('*') just returns the original 6 columns with the
--    new fields undefined, and the code already catches a missing
--    pose_guide_products table), so the feature has been rendering blank
--    rather than throwing.
--
--    Hardened relative to the original: "Staff can manage
--    pose_guide_products" used a raw `role IN ('admin','owner','staff')`
--    check with no is_blocked/employment_status guard -- same F3-class gap.
--    Uses is_staff_or_admin() directly instead.
--
--    messages.sender_role from the same source file is intentionally NOT
--    included: confirmed via repo search that no code in either app reads
--    or writes it.
--
-- 3. cascade_soft_delete_inventory trigger
--    (20260810000002_cascade_soft_delete_trigger.sql). Its own comment
--    explains it replaces an unreliable client-side cascade in
--    supabaseService.js that could leave orphaned active inventory if the
--    network dropped between the two sequential requests -- that
--    known-unreliable path has been the only one actually running.
--
--    Verified inventory.product_doc_id and products.deleted_at are real
--    columns (legacy Firestore-era naming, consistent with the rest of this
--    schema) before applying. Adds SET search_path, which the original
--    omitted -- not a privilege-escalation gap since this is SECURITY
--    INVOKER, just brought in line with this codebase's convention of
--    always pinning it.
--
-- All three applied and verified live via rolled-back tests before this PR:
-- update_staff_role successfully reassigns a role and is rejected on a
-- second un-authorized attempt; a pose_guides select returns the new
-- columns and pose_guide_products round-trips; soft-deleting a test product
-- correctly cascades to its inventory rows.

-- ── 1. update_staff_role ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_staff_role(
  target_user_id uuid,
  new_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  target_role text;
BEGIN
  IF NOT public.is_admin_or_owner() THEN
    RAISE EXCEPTION 'Only admins or owners can change staff roles';
  END IF;

  IF new_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Role must be "staff" or "admin"';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  SELECT role INTO target_role
  FROM public.profiles
  WHERE id = target_user_id AND deleted = false;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found or is deleted';
  END IF;

  IF target_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Cannot modify a % role', target_role;
  END IF;

  UPDATE public.profiles
  SET role = new_role, updated_at = now()
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_staff_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_staff_role(uuid, text) TO authenticated;

-- ── 2. pose_guides style gallery ─────────────────────────────
ALTER TABLE public.pose_guides
  ADD COLUMN IF NOT EXISTS image_url      text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS occasion       text,
  ADD COLUMN IF NOT EXISTS style_tags     text[],
  ADD COLUMN IF NOT EXISTS difficulty     text DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS is_featured    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_pose_type text DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS sort_order     integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pose_guide_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pose_guide_id   text NOT NULL REFERENCES public.pose_guides(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(pose_guide_id, product_id)
);

ALTER TABLE public.pose_guide_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pose_guide_products"
  ON public.pose_guide_products FOR SELECT USING (true);

CREATE POLICY "Staff can manage pose_guide_products"
  ON public.pose_guide_products FOR ALL
  USING (public.is_staff_or_admin());

ALTER PUBLICATION supabase_realtime ADD TABLE public.pose_guide_products;

INSERT INTO storage.buckets (id, name, public) VALUES ('pose-images', 'pose-images', true)
  ON CONFLICT (id) DO NOTHING;

-- ── 3. cascade soft-delete ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.cascade_soft_delete_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.deleted = true AND OLD.deleted IS DISTINCT FROM true THEN
    UPDATE public.inventory
    SET deleted = true,
        deleted_at = COALESCE(NEW.deleted_at, NOW()),
        updated_at = NOW()
    WHERE product_doc_id = NEW.id
      AND deleted IS DISTINCT FROM true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_soft_delete_inventory ON public.products;
CREATE TRIGGER trg_cascade_soft_delete_inventory
  AFTER UPDATE OF deleted ON public.products
  FOR EACH ROW
  WHEN (NEW.deleted = true)
  EXECUTE FUNCTION public.cascade_soft_delete_inventory();
