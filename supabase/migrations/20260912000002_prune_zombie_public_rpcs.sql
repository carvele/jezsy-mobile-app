-- Migration: 20260912000002_prune_zombie_public_rpcs.sql
-- Description: Safely drops 8 authorized zombie and superseded RPC procedures under Phase B7-e.
-- Preflight: 0 dependent objects in pg_depend, 0 active cron.job invocations, 0 RLS references, 0 client callers.

-- 1. Retired cron wrapper (superseded by direct expire_all_stale_reservations cron invocation)
DROP FUNCTION IF EXISTS public.auto_cancel_expired_reservations();

-- 2. Redundant wrapper (superseded by direct expire_all_stale_reservations cron invocation)
DROP FUNCTION IF EXISTS public.expire_unpaid_reservations();

-- 3. Redundant SECURITY INVOKER alias (superseded by update_staff_role_v2)
DROP FUNCTION IF EXISTS public.update_staff_role(uuid, text);

-- 4. Superseded pickup precursor (superseded by complete_reservation_handover)
DROP FUNCTION IF EXISTS public.complete_reservation_pickup(uuid, uuid, text);

-- 5. Superseded pickup token verifier (superseded by complete_reservation_handover)
DROP FUNCTION IF EXISTS public.verify_pickup(uuid);

-- 6. Orphaned pre-signup email enumeration surface
DROP FUNCTION IF EXISTS public.check_email_exists(text);

-- 7. Superseded customer reschedule RPC (superseded by request_reschedule / resolve_reschedule_as_manager workflow)
DROP FUNCTION IF EXISTS public.reschedule_reservation(uuid, text, text);

-- 8. Superseded pg_trgm fuzzy search RPC (superseded by faceted search_catalog)
DROP FUNCTION IF EXISTS public.search_catalog_fuzzy(text, integer);
