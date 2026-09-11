-- AR Garment Recoloring (Phase 1): a variant-level AR-rendering color hint.
--
-- Approved Phase 1 denormalization: color belongs to the sellable
-- (product_doc_id, size, color) variant, not a separate color/variant
-- dimension JezSy doesn't have yet, so this lives on inventory alongside
-- the existing `color` name column rather than on products. Two sizes of
-- the same commercial color can in principle drift to different hex
-- values (see the Admin service's normalization + the manual verification
-- plan's cross-size consistency check) -- accepted for Phase 1.
--
-- This is an AR RENDERING APPROXIMATION, not a colorimetric/Pantone-exact
-- record: lighting, display gamut, the GLB's base texture, and Three.js
-- tone mapping all affect what the customer actually sees. Admin-facing
-- copy should read "AR Color", not "exact fabric color".
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS hex_color TEXT;

-- Case-insensitive so either #18233F or #18233f is accepted at the DB
-- layer; textual case normalization (so the two don't become distinct-
-- looking values for the same color) is the Admin service's job, not a
-- constraint concern.
ALTER TABLE public.inventory
  ADD CONSTRAINT chk_hex_color CHECK (
    hex_color IS NULL OR hex_color ~* '^#[0-9a-f]{6}$'
  );

-- A newly added column has no grants of its own even though the table
-- already has broad SELECT/INSERT grants -- those were issued against the
-- column list that existed at the time, and do not retroactively cover a
-- column added later. SELECT/INSERT mirror the existing `color` column's
-- grants (both anon and authenticated); UPDATE mirrors the "benign
-- metadata" column list from 20260908150000_inventory_grant_revocation.sql
-- -- hex_color is a rendering hint, not a stock/hold/lifecycle/identity
-- column, so it belongs on that list, unlike `color` itself (which is
-- deliberately create-only, per that migration's own boundary).
GRANT SELECT (hex_color) ON public.inventory TO anon, authenticated;
GRANT INSERT (hex_color) ON public.inventory TO anon, authenticated;
GRANT UPDATE (hex_color) ON public.inventory TO authenticated;
