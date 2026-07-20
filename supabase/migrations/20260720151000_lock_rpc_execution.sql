-- Migration: Stop exposing trigger-only and unguarded functions as public RPCs
--
-- Trigger-only functions with no business reason to be public RPCs:
-- handle_new_user, sync_conversation_on_message, approve_device,
-- check_profile_updates, log_staff_status_change,
-- prevent_stock_movement_updates, update_product_rating, rls_auto_enable,
-- validate_reservation_time. None are called via .rpc() by either app.
--
-- update_user_streak(p_user_id uuid) had no authorization check at all --
-- any caller could pass an arbitrary p_user_id. Neither app currently calls
-- it, so rewriting to use auth.uid() instead of a parameter is non-breaking.
--
-- check_email_exists left anon-callable (mobile pre-signup flow needs it).
-- update_staff_status already self-guards internally; anon revoked as a
-- pointless attempt surface, authenticated kept.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_conversation_on_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_device() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_profile_updates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_staff_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_stock_movement_updates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_product_rating() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_reservation_time() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_staff_status(uuid, text, boolean, text) FROM anon;

CREATE OR REPLACE FUNCTION public.update_user_streak()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_streak public.user_streaks%ROWTYPE;
    v_today DATE := CURRENT_DATE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_streak FROM public.user_streaks WHERE user_id = v_user_id;

    IF NOT FOUND THEN
        INSERT INTO public.user_streaks (user_id, current_streak, longest_streak, last_action_date)
        VALUES (v_user_id, 1, 1, v_today);
    ELSE
        IF v_streak.last_action_date = v_today THEN
            RETURN;
        ELSIF v_streak.last_action_date = v_today - INTERVAL '1 day' THEN
            UPDATE public.user_streaks SET
                current_streak = current_streak + 1,
                longest_streak = GREATEST(longest_streak, current_streak + 1),
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = v_user_id;
        ELSE
            UPDATE public.user_streaks SET
                current_streak = 1,
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = v_user_id;
        END IF;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_streak() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_streak() TO authenticated;

DROP FUNCTION IF EXISTS public.update_user_streak(uuid);
