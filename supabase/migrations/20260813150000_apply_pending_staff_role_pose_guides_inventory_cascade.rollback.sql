-- Rollback for 20260813150000_apply_pending_staff_role_pose_guides_inventory_cascade.sql.
-- Removes all three pieces this migration brought live. Note this
-- re-breaks StaffManagement.jsx's role editor and the mobile Style Pose
-- gallery, and restores reliance on the unaudited client-side inventory
-- cascade -- only use this to revert, not as a template.

DROP TRIGGER IF EXISTS trg_cascade_soft_delete_inventory ON public.products;
DROP FUNCTION IF EXISTS public.cascade_soft_delete_inventory();

ALTER PUBLICATION supabase_realtime DROP TABLE public.pose_guide_products;
DROP TABLE IF EXISTS public.pose_guide_products;

ALTER TABLE public.pose_guides
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS occasion,
  DROP COLUMN IF EXISTS style_tags,
  DROP COLUMN IF EXISTS difficulty,
  DROP COLUMN IF EXISTS is_featured,
  DROP COLUMN IF EXISTS base_pose_type,
  DROP COLUMN IF EXISTS sort_order;

DROP FUNCTION IF EXISTS public.update_staff_role(uuid, text);
