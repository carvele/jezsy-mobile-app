-- Fix cascade triggers for product soft delete, restore, and inventory seed
-- Issue: Direct updates to products.deleted from admin-dashboard fire triggers that execute UPDATE/INSERT
-- on public.inventory. Because triggers run as SECURITY INVOKER by default, they failed with:
-- "permission denied for table inventory" (403) due to column-level privileges on inventory.
-- Marking them SECURITY DEFINER ensures the internal trigger logic executes with proper table permissions.

-- 1. Cascade Soft-Delete & Restore
CREATE OR REPLACE FUNCTION public.cascade_soft_delete_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Cascade archive (soft delete)
  IF NEW.deleted = true AND OLD.deleted IS DISTINCT FROM true THEN
    UPDATE public.inventory
    SET deleted = true,
        deleted_at = COALESCE(NEW.deleted_at, NOW()),
        updated_at = NOW()
    WHERE product_doc_id = NEW.id
      AND deleted IS DISTINCT FROM true;
  END IF;

  -- Cascade unarchive (restore)
  IF NEW.deleted = false AND OLD.deleted = true THEN
    UPDATE public.inventory
    SET deleted = false,
        deleted_at = NULL,
        updated_at = NOW()
    WHERE product_doc_id = NEW.id
      AND deleted = true;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger fires on any deleted change (both soft-delete and restore)
DROP TRIGGER IF EXISTS trg_cascade_soft_delete_inventory ON public.products;
CREATE TRIGGER trg_cascade_soft_delete_inventory
  AFTER UPDATE OF deleted ON public.products
  FOR EACH ROW
  WHEN (NEW.deleted IS DISTINCT FROM OLD.deleted)
  EXECUTE FUNCTION public.cascade_soft_delete_inventory();

-- 2. Seed Inventory for New Products
-- When a product without explicit sizes is created, the auto-seed trigger inserts
-- default inventory. Marking it SECURITY DEFINER guarantees it never fails on permissions.
ALTER FUNCTION public.seed_inventory_for_new_product()
  SECURITY DEFINER
  SET search_path = public, pg_temp;
