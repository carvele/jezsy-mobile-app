-- ============================================================================
-- Migration: 20260910190000_harden_mutable_search_paths.sql
-- Description: Security Pass A2 — Remediating 12 Mutable search_path Functions
-- ============================================================================

-- Group 1: Product Catalog & Discovery RPCs
ALTER FUNCTION public.get_review_stats(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_trending_products(integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.search_catalog(text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, numeric, numeric, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.search_catalog_fuzzy(text, integer)
  SET search_path = public, pg_temp;

-- Group 2: Internal Trigger Functions
ALTER FUNCTION public.notify_admin_on_reservation()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.seed_inventory_for_new_product()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.set_connections_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.set_direct_chats_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.sync_product_category_id()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.sync_profile_full_name()
  SET search_path = public, pg_temp;

-- Group 3: Clean Retirement of Obsolete UUID Min Aggregate
-- sync_product_category_id uses native min(c.id::text)::uuid; 0 dependents exist.
DROP AGGREGATE IF EXISTS public.min(uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.min_uuid_step(uuid, uuid) RESTRICT;
