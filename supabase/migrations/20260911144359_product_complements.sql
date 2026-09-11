-- Complete the Look (Phase 1): merchant-curated product complement links.
--
-- Column-level grants are the load-bearing security control here, not just
-- RLS: RLS governs which ROWS a role can see, not which COLUMNS. All logged
-- in customers and staff/admin clients share the single `authenticated`
-- Postgres role, so a bare `GRANT SELECT ... TO authenticated` would let any
-- customer read audit metadata (created_by/updated_by/origin/timestamps)
-- through the public product page. Every client (anon and authenticated
-- alike) is granted SELECT on the public relationship columns only; write
-- columns are granted separately to authenticated, and RLS's
-- can_manage_inventory() check is what actually stops an ordinary customer
-- from writing at all.

CREATE TABLE IF NOT EXISTS public.product_complements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  complementary_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Provenance: 'manual' (staff-added), 'styled_look_suggestion' (promoted
  -- from a pose_guides sibling), 'algorithmic_suggestion' (promoted from the
  -- Tier 3 heuristic fallback).
  origin TEXT NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT product_complements_pair_unique UNIQUE (product_id, complementary_product_id),
  CONSTRAINT product_complements_not_self CHECK (product_id <> complementary_product_id),
  CONSTRAINT product_complements_origin_check CHECK (origin IN ('manual', 'styled_look_suggestion', 'algorithmic_suggestion')),
  CONSTRAINT product_complements_sort_order_check CHECK (sort_order >= 0)
);

-- Main read path: "give me product X's active complements in display order."
CREATE INDEX IF NOT EXISTS idx_product_complements_read
  ON public.product_complements (product_id, is_active, sort_order);

-- Reverse lookup for cascade/impact queries ("what links to this product?").
CREATE INDEX IF NOT EXISTS idx_product_complements_reverse
  ON public.product_complements (complementary_product_id);

-- --------------------------------------------------------
-- Trigger-owned audit metadata
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_product_complements_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by = auth.uid();
    NEW.created_at = now();
    NEW.updated_by = auth.uid();
    NEW.updated_at = now();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Creation metadata is immutable once set.
    NEW.created_by = OLD.created_by;
    NEW.created_at = OLD.created_at;
    NEW.updated_by = auth.uid();
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

-- The trigger still fires on every INSERT/UPDATE regardless of this revoke --
-- triggers execute as the table owner, not the invoking role. This only
-- blocks a client from calling the function directly (e.g. to forge an
-- audit row without going through the table's own INSERT/UPDATE).
REVOKE ALL ON FUNCTION public.trg_product_complements_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS before_insert_update_product_complements ON public.product_complements;
CREATE TRIGGER before_insert_update_product_complements
  BEFORE INSERT OR UPDATE ON public.product_complements
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_complements_audit();

-- --------------------------------------------------------
-- RLS: row-level policies
-- --------------------------------------------------------
ALTER TABLE public.product_complements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active complements" ON public.product_complements;
CREATE POLICY "Public read active complements"
  ON public.product_complements FOR SELECT
  TO public
  USING (is_active = true);

DROP POLICY IF EXISTS "Manage complements insert" ON public.product_complements;
CREATE POLICY "Manage complements insert"
  ON public.product_complements FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "Manage complements update" ON public.product_complements;
CREATE POLICY "Manage complements update"
  ON public.product_complements FOR UPDATE
  TO authenticated
  USING (public.can_manage_inventory())
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "Manage complements delete" ON public.product_complements;
CREATE POLICY "Manage complements delete"
  ON public.product_complements FOR DELETE
  TO authenticated
  USING (public.can_manage_inventory());

-- --------------------------------------------------------
-- Column-level grants: the actual privacy boundary (see header note)
-- --------------------------------------------------------
REVOKE ALL ON public.product_complements FROM PUBLIC, anon, authenticated;

-- Every client, logged in or not, may read the public relationship shape
-- only -- never audit actor/timestamp/origin columns.
GRANT SELECT (
  id,
  product_id,
  complementary_product_id,
  sort_order
) ON public.product_complements TO anon, authenticated;

-- Write columns for authenticated operators. RLS's can_manage_inventory()
-- check (above) is what actually stops an ordinary customer from using
-- these grants; the trigger owns created_by/updated_by/created_at/
-- updated_at regardless of what a client sends, so those are deliberately
-- not in this list.
GRANT INSERT (
  product_id,
  complementary_product_id,
  sort_order,
  origin,
  is_active
) ON public.product_complements TO authenticated;

GRANT UPDATE (
  sort_order,
  origin,
  is_active
) ON public.product_complements TO authenticated;

GRANT DELETE ON public.product_complements TO authenticated;
