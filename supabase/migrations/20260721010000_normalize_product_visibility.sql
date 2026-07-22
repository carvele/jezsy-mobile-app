-- Migration: Normalize products.visibility to match RLS/RPC expectations
--
-- admin-dashboard's ProductForm.jsx has always written visibility as the
-- capitalized English words 'Draft' / 'Published'. But every RLS policy and
-- RPC that gates customer-facing/order/reservation access checks the
-- lowercase word 'public' instead (20260701090000_audit_hardening.sql,
-- 20260701110000_audit_hardening_resume.sql, 20260719130000_create_
-- reservation_rpc.sql, 20260720120000_reservation_drop_return_date.sql all
-- do `AND visibility = 'public'`). Since the admin app never wrote that
-- literal string, products created/edited there could never satisfy those
-- checks -- they'd be functionally invisible in any flow gated by them.
--
-- Fix: standardize the column's values to what the RLS/RPC layer already
-- expects ('draft' / 'public'), backfill existing rows, then constrain going
-- forward so the two layers can't drift apart again. No RLS/RPC file needs
-- to change -- they're already correct.

UPDATE public.products SET visibility = 'public' WHERE visibility = 'Published';
UPDATE public.products SET visibility = 'draft'  WHERE visibility IS NULL OR visibility NOT IN ('public');

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_visibility_check;
ALTER TABLE public.products ADD CONSTRAINT products_visibility_check
  CHECK (visibility IN ('draft', 'public', 'archived'));
