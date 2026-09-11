-- Migration: 20260912000001_revoke_anon_increment_wear_count.sql
-- Purpose: Remediate B6-GRANT-LEAK-001 by revoking anonymous and PUBLIC execution privileges on increment_wear_count(uuid).
-- Security Invariant: Function mutates wardrobe wear logs and must only be executable by authenticated users.

REVOKE EXECUTE ON FUNCTION public.increment_wear_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_wear_count(uuid) TO authenticated;
