-- Migration: 20260910300000_revoke_anon_execute_on_rls_helpers
-- Post-F3 Helper Cleanup Stage 2: Revoke anon EXECUTE on RLS role-check helpers
-- Target Security Advisor findings: SEC-A1-018 (is_admin_or_owner), SEC-A1-019 (is_staff_or_admin)
-- Stage 1 verified that 0 policies across all non-system schemas evaluate these helpers under public or anon.
-- Dependency scans confirmed zero reachable anonymous paths via views, RPCs, or triggers.
-- Authenticated execute privileges are preserved.

REVOKE EXECUTE ON FUNCTION public.is_admin_or_owner() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin() FROM anon;
