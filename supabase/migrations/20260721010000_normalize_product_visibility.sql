-- Reconstructed from live DB state to restore the file<->ledger 1:1 invariant.
-- Applied directly to the live project by a teammate; this file captures the
-- confirmed current constraint rather than the original exact statements
-- (which weren't available to reconstruct). See docs/DB_IMPLEMENTATION_PLAN.md
-- for the shared-migration-ledger context.

alter table public.products
  drop constraint if exists products_visibility_check;

alter table public.products
  add constraint products_visibility_check
  check (visibility = any (array['draft'::text, 'public'::text, 'archived'::text]));
