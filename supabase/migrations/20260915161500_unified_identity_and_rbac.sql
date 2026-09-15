-- RBAC-2A: Additive Foundation for Unified Identity & RBAC

BEGIN;

-- 1. Add account_kind to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'customer'
CHECK (account_kind IN ('customer', 'workforce'));

-- 2. Capabilities Tables
CREATE TABLE IF NOT EXISTS public.capabilities (
    id text PRIMARY KEY,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_capabilities (
    role text NOT NULL CHECK (role IN ('staff', 'admin', 'owner')),
    capability_id text NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role, capability_id)
);

-- 3. Staff Memberships (FK references public.profiles(id) directly)
CREATE TABLE IF NOT EXISTS public.staff_memberships (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('staff', 'admin', 'owner')),
    employment_status text NOT NULL CHECK (employment_status IN ('invited', 'active', 'suspended', 'resigned', 'terminated')),
    device_approval_state text NOT NULL DEFAULT 'not_required' CHECK (device_approval_state IN ('not_required', 'pending', 'approved', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Capability overrides table bound directly to staff_memberships(user_id)
CREATE TABLE IF NOT EXISTS public.staff_capability_overrides (
    user_id uuid NOT NULL REFERENCES public.staff_memberships(user_id) ON DELETE CASCADE,
    capability_id text NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
    override_type text NOT NULL CHECK (override_type IN ('allow', 'deny')),
    created_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, capability_id)
);

-- Secure the new tables with RLS
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_capability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_memberships ENABLE ROW LEVEL SECURITY;

-- 4. Initial Backfill (Strictly narrow to proven authority, fail-closed ON CONFLICT DO NOTHING)
UPDATE public.profiles
SET account_kind = 'workforce'
WHERE role IN ('staff', 'admin', 'owner');

INSERT INTO public.staff_memberships (user_id, role, employment_status, device_approval_state)
SELECT
    id,
    role,
    COALESCE(employment_status, 'active'),
    'not_required'
FROM public.profiles
WHERE account_kind = 'workforce' AND role IN ('staff', 'admin', 'owner')
ON CONFLICT (user_id) DO NOTHING;

-- 5. Seed Capabilities (Frozen role/capability matrix with granular lifecycle & device bounds)
INSERT INTO public.capabilities (id, description) VALUES
('analytics.view', 'View analytics dashboard'),
('inventory.manage', 'Manage inventory stock and SKUs'),
('catalog.manage', 'Manage catalog products'),
('reservations.view', 'View customer reservations'),
('reservations.operate', 'Fulfill and manage reservations'),
('customer.measurements.read', 'Read customer fitting and measurement details'),
('reviews.moderate', 'Moderate customer product reviews'),
('audit.read', 'Read system and security audit logs'),
('staff.read', 'View staff directory and workforce details'),
('staff.lifecycle.manage', 'Invite, suspend, resign, or terminate staff memberships'),
('staff.role.manage', 'Promote, demote, or modify workforce roles'),
('device.approve', 'Approve or revoke staff device access'),
('security.device_policy.manage', 'Manage global device approval policy (Owner-sensitive)'),
('owner.manage', 'Manage Phase 2 owner lifecycle operations (Owner-sensitive)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_id) VALUES
-- Staff permissions (operational floor)
('staff', 'reservations.view'),
('staff', 'reservations.operate'),
('staff', 'inventory.manage'),
('staff', 'customer.measurements.read'),

-- Admin permissions (broad management, excludes sensitive workforce lifecycle & policy)
('admin', 'analytics.view'),
('admin', 'inventory.manage'),
('admin', 'catalog.manage'),
('admin', 'reservations.view'),
('admin', 'reservations.operate'),
('admin', 'customer.measurements.read'),
('admin', 'reviews.moderate'),
('admin', 'audit.read'),
('admin', 'staff.read'),
('admin', 'device.approve'),

-- Owner permissions (All administrative + sensitive lifecycle/policy authorities)
('owner', 'analytics.view'),
('owner', 'inventory.manage'),
('owner', 'catalog.manage'),
('owner', 'reservations.view'),
('owner', 'reservations.operate'),
('owner', 'customer.measurements.read'),
('owner', 'reviews.moderate'),
('owner', 'audit.read'),
('owner', 'staff.read'),
('owner', 'device.approve'),
('owner', 'staff.lifecycle.manage'),
('owner', 'staff.role.manage'),
('owner', 'security.device_policy.manage'),
('owner', 'owner.manage')
ON CONFLICT (role, capability_id) DO NOTHING;

-- 6. RPC Helpers
CREATE OR REPLACE FUNCTION public.is_customer_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND account_kind = 'customer'
          AND deleted = false
          AND is_blocked = false
    );
$$$;
REVOKE EXECUTE ON FUNCTION public.is_customer_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_customer_account() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
    SELECT EXISTS (
        SELECT 1 FROM public.staff_memberships sm
        JOIN public.profiles p ON p.id = sm.user_id
        WHERE sm.user_id = auth.uid()
          AND p.account_kind = 'workforce'
          AND sm.employment_status = 'active'
          AND sm.device_approval_state IN ('approved', 'not_required')
          AND p.is_blocked = false
          AND p.deleted = false
    );
$$$;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
    SELECT EXISTS (
        SELECT 1 FROM public.staff_memberships sm
        JOIN public.profiles p ON p.id = sm.user_id
        WHERE sm.user_id = auth.uid()
          AND p.account_kind = 'workforce'
          AND sm.role IN ('admin', 'owner')
          AND sm.employment_status = 'active'
          AND sm.device_approval_state IN ('approved', 'not_required')
          AND p.is_blocked = false
          AND p.deleted = false
    );
$$$;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_capability(p_actor_id uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
    SELECT COALESCE((
        SELECT
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM public.staff_capability_overrides o
                    WHERE o.user_id = p_actor_id
                      AND o.capability_id = p_capability
                      AND o.override_type = 'deny'
                ) THEN false
                WHEN EXISTS (
                    SELECT 1
                    FROM public.staff_capability_overrides o
                    WHERE o.user_id = p_actor_id
                      AND o.capability_id = p_capability
                      AND o.override_type = 'allow'
                ) THEN true
                ELSE EXISTS (
                    SELECT 1
                    FROM public.role_capabilities rc
                    WHERE rc.role = sm.role
                      AND rc.capability_id = p_capability
                )
            END
        FROM public.staff_memberships sm
        JOIN public.profiles p ON p.id = sm.user_id
        WHERE sm.user_id = p_actor_id
          AND p.account_kind = 'workforce'
          AND sm.employment_status = 'active'
          AND sm.device_approval_state IN ('approved', 'not_required')
          AND p.is_blocked = false
          AND p.deleted = false
    ), false);
$$$;
REVOKE EXECUTE ON FUNCTION public.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
    SELECT public.has_capability(auth.uid(), p_capability);
$$$;
REVOKE EXECUTE ON FUNCTION public.has_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_capability(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_actor_capability(p_actor_id uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
BEGIN
    IF NOT public.has_capability(p_actor_id, p_capability) THEN
        RAISE EXCEPTION 'Actor % lacks required capability: %', p_actor_id, p_capability USING ERRCODE = '42501';
    END IF;
END;
$$$;
REVOKE EXECUTE ON FUNCTION public.assert_actor_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_actor_capability(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_capability(p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
BEGIN
    IF NOT public.has_capability(auth.uid(), p_capability) THEN
        RAISE EXCEPTION 'Session lacks required capability: %', p_capability USING ERRCODE = '42501';
    END IF;
END;
$$$;
REVOKE EXECUTE ON FUNCTION public.assert_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_capability(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_staff_context()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$$
DECLARE
    v_uid uuid := auth.uid();
    v_profile record;
    v_membership record;
    v_capabilities text[];
BEGIN
    IF v_uid IS NULL THEN
        RETURN json_build_object('authorized', false);
    END IF;

    SELECT account_kind, is_blocked, deleted INTO v_profile
    FROM public.profiles WHERE id = v_uid;

    IF v_profile IS NULL OR v_profile.account_kind != 'workforce' OR v_profile.is_blocked OR v_profile.deleted THEN
        RETURN json_build_object(
            'authorized', false,
            'account_kind', COALESCE(v_profile.account_kind, 'customer')
        );
    END IF;

    SELECT role, employment_status, device_approval_state INTO v_membership
    FROM public.staff_memberships WHERE user_id = v_uid;

    IF v_membership IS NULL THEN
        RETURN json_build_object(
            'authorized', false,
            'account_kind', 'workforce',
            'error', 'Missing membership record'
        );
    END IF;

    -- If inactive or device approval not met, unauthorized workforce: capabilities must be empty
    IF v_membership.employment_status != 'active'
       OR v_membership.device_approval_state NOT IN ('approved', 'not_required')
    THEN
        RETURN json_build_object(
            'authorized', false,
            'account_kind', 'workforce',
            'role', v_membership.role,
            'employment_status', v_membership.employment_status,
            'device_approval_state', v_membership.device_approval_state,
            'capabilities', ARRAY[]::text[]
        );
    END IF;

    -- Resolve capabilities only for active & eligible workforce (deterministic ORDER BY)
    SELECT array_agg(DISTINCT c.cap ORDER BY c.cap) INTO v_capabilities
    FROM (
        SELECT capability_id as cap FROM public.role_capabilities WHERE role = v_membership.role
        UNION
        SELECT capability_id as cap FROM public.staff_capability_overrides WHERE user_id = v_uid AND override_type = 'allow'
    ) c
    WHERE NOT EXISTS (
        SELECT 1 FROM public.staff_capability_overrides sco 
        WHERE sco.user_id = v_uid AND sco.capability_id = c.cap AND sco.override_type = 'deny'
    );

    RETURN json_build_object(
        'authorized', true,
        'account_kind', 'workforce',
        'role', v_membership.role,
        'employment_status', v_membership.employment_status,
        'device_approval_state', v_membership.device_approval_state,
        'capabilities', COALESCE(v_capabilities, ARRAY[]::text[])
    );
END;
$$$;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_staff_context() TO authenticated;

-- 7. Triggers: updated_at and One-Way Projection (Membership -> Profiles, enforcing account_kind = 'workforce')
CREATE OR REPLACE FUNCTION public.set_staff_memberships_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$$;
REVOKE EXECUTE ON FUNCTION public.set_staff_memberships_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_staff_memberships_updated_at ON public.staff_memberships;
CREATE TRIGGER trg_staff_memberships_updated_at
BEFORE UPDATE ON public.staff_memberships
FOR EACH ROW
EXECUTE FUNCTION public.set_staff_memberships_updated_at();

CREATE OR REPLACE FUNCTION public.sync_membership_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$$
BEGIN
    UPDATE public.profiles
    SET 
        account_kind = 'workforce',
        role = NEW.role,
        employment_status = NEW.employment_status,
        updated_at = now()
    WHERE id = NEW.user_id;
    
    RETURN NEW;
END;
$$$;
REVOKE EXECUTE ON FUNCTION public.sync_membership_to_profile() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_membership_to_profile ON public.staff_memberships;
CREATE TRIGGER trg_sync_membership_to_profile
AFTER INSERT OR UPDATE ON public.staff_memberships
FOR EACH ROW
EXECUTE FUNCTION public.sync_membership_to_profile();

-- 8. Hard Assertions
DO $$$
DECLARE
    v_missing_membership integer;
    v_workforce_without_membership integer;
    v_missing_workforce_kind integer;
    v_role_mismatch integer;
    v_status_mismatch integer;
    v_unknown_roles integer;
    v_owner_mismatch integer;
    v_old_owners integer;
    v_new_owners integer;
BEGIN
    -- 1. Legacy workforce profiles without membership
    SELECT count(*) INTO v_missing_membership
    FROM public.profiles p
    LEFT JOIN public.staff_memberships sm ON sm.user_id = p.id
    WHERE p.role IN ('staff', 'admin', 'owner') AND sm.user_id IS NULL;

    -- 2. Every workforce profile without membership
    SELECT count(*) INTO v_workforce_without_membership
    FROM public.profiles p
    WHERE p.account_kind = 'workforce'
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_memberships sm
        WHERE sm.user_id = p.id
      );

    -- 3. Membership rows without workforce account_kind
    SELECT count(*) INTO v_missing_workforce_kind
    FROM public.staff_memberships sm
    JOIN public.profiles p ON p.id = sm.user_id
    WHERE p.account_kind != 'workforce';

    -- 4. Role mismatches between profile and membership
    SELECT count(*) INTO v_role_mismatch
    FROM public.staff_memberships sm
    JOIN public.profiles p ON p.id = sm.user_id
    WHERE sm.role != p.role;

    -- 5. Employment-state mismatches
    SELECT count(*) INTO v_status_mismatch
    FROM public.staff_memberships sm
    JOIN public.profiles p ON p.id = sm.user_id
    WHERE sm.employment_status != COALESCE(p.employment_status, 'active');

    -- 6. Unknown workforce roles
    SELECT count(*) INTO v_unknown_roles
    FROM public.staff_memberships
    WHERE role NOT IN ('staff', 'admin', 'owner');

    -- 7. Owner-count mismatch
    SELECT count(*) INTO v_old_owners FROM public.profiles WHERE role = 'owner';
    SELECT count(*) INTO v_new_owners FROM public.staff_memberships WHERE role = 'owner';
    v_owner_mismatch := abs(v_old_owners - v_new_owners);

    IF v_missing_membership > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % legacy workforce profiles missing membership', v_missing_membership; END IF;
    IF v_workforce_without_membership > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % workforce profiles missing membership', v_workforce_without_membership; END IF;
    IF v_missing_workforce_kind > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % memberships missing workforce account_kind', v_missing_workforce_kind; END IF;
    IF v_role_mismatch > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % role mismatches between profile and membership', v_role_mismatch; END IF;
    IF v_status_mismatch > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % employment_status mismatches', v_status_mismatch; END IF;
    IF v_unknown_roles > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: % unknown roles in memberships', v_unknown_roles; END IF;
    IF v_owner_mismatch > 0 THEN RAISE EXCEPTION 'ASSERTION FAILED: Owner count mismatch. Old: %, New: %', v_old_owners, v_new_owners; END IF;
END;
$$$;

COMMIT;
