-- Migration: 20260919011500_scope_admin_notifications_to_current_user.sql
-- Description:
-- 1. Redefine admin_user_notifications_view with security_invoker = true and explicit WHERE r.user_id = (SELECT auth.uid())
-- 2. Drop and recreate mark_admin_notifications_read(UUID[]) and dismiss_admin_notifications(UUID[]) to:
--    - Return integer (affected row count)
--    - Enforce p_receipt_ids IS NULL -> bulk action for caller
--    - Enforce p_receipt_ids = '{}' -> explicit NO-OP (returns 0)
--    - Enforce non-empty p_receipt_ids -> affect only matching caller-owned receipts
--    - Retain SECURITY DEFINER, search_path = '', auth.uid() check, explicit grants

-- 1. Redefine the view with security_invoker = true and caller isolation
CREATE OR REPLACE VIEW public.admin_user_notifications_view
WITH (security_invoker = true) AS
SELECT 
    r.id, -- receipt id used by UI for updates
    r.notification_id,
    r.user_id,
    n.title,
    n.message,
    n.type,
    n.event_key,
    n.actor_id,
    n.entity_type,
    n.entity_id,
    n.data,
    n.priority,
    r.is_read,
    r.is_dismissed,
    n.created_at
FROM public.admin_notifications n
JOIN public.admin_notification_receipts r ON n.id = r.notification_id
WHERE r.user_id = (SELECT auth.uid())
  AND r.is_dismissed = false;

REVOKE ALL ON public.admin_user_notifications_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_user_notifications_view TO authenticated;

-- 2. Drop previous functions to allow return type update to integer
DROP FUNCTION IF EXISTS public.mark_admin_notifications_read(UUID[]);
DROP FUNCTION IF EXISTS public.dismiss_admin_notifications(UUID[]);

-- 3. Hardened mark_admin_notifications_read
CREATE OR REPLACE FUNCTION public.mark_admin_notifications_read(p_receipt_ids UUID[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_affected integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Empty array explicitly means NO-OP (update 0 rows)
    IF p_receipt_ids IS NOT NULL AND coalesce(cardinality(p_receipt_ids), 0) = 0 THEN
        RETURN 0;
    END IF;

    UPDATE public.admin_notification_receipts
    SET is_read = true
    WHERE user_id = (SELECT auth.uid())
      AND is_read = false
      AND (p_receipt_ids IS NULL OR id = ANY(p_receipt_ids));

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_admin_notifications_read(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_admin_notifications_read(UUID[]) TO authenticated;

-- 4. Hardened dismiss_admin_notifications
CREATE OR REPLACE FUNCTION public.dismiss_admin_notifications(p_receipt_ids UUID[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_affected integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Empty array explicitly means NO-OP (update 0 rows)
    IF p_receipt_ids IS NOT NULL AND coalesce(cardinality(p_receipt_ids), 0) = 0 THEN
        RETURN 0;
    END IF;

    UPDATE public.admin_notification_receipts
    SET is_dismissed = true
    WHERE user_id = (SELECT auth.uid())
      AND is_dismissed = false
      AND (p_receipt_ids IS NULL OR id = ANY(p_receipt_ids));

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_admin_notifications(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_admin_notifications(UUID[]) TO authenticated;
