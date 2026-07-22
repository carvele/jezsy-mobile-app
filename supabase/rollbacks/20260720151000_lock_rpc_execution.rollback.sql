-- Rollback for 20260720151000_lock_rpc_execution.sql

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_conversation_on_message() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_device() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_profile_updates() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_staff_status_change() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_stock_movement_updates() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product_rating() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_reservation_time() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_staff_status(uuid, text, boolean, text) TO anon;

CREATE OR REPLACE FUNCTION public.update_user_streak(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_streak user_streaks%ROWTYPE;
    v_today DATE := CURRENT_DATE;
BEGIN
    SELECT * INTO v_streak FROM user_streaks WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_action_date)
        VALUES (p_user_id, 1, 1, v_today);
    ELSE
        IF v_streak.last_action_date = v_today THEN
            RETURN;
        ELSIF v_streak.last_action_date = v_today - INTERVAL '1 day' THEN
            UPDATE user_streaks SET
                current_streak = current_streak + 1,
                longest_streak = GREATEST(longest_streak, current_streak + 1),
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = p_user_id;
        ELSE
            UPDATE user_streaks SET
                current_streak = 1,
                last_action_date = v_today,
                updated_at = NOW()
            WHERE user_id = p_user_id;
        END IF;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_streak(uuid) TO PUBLIC;
DROP FUNCTION IF EXISTS public.update_user_streak();
