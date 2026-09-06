-- Remediate MSG-001 (TOCTOU race condition in chat creation)
-- and MSG-005 (missing SET search_path hardening).

CREATE OR REPLACE FUNCTION public.get_or_create_direct_chat(other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_chat_id uuid;
    v_lock_key bigint;
BEGIN
    -- Ensure connection exists
    IF NOT EXISTS (
        SELECT 1 FROM public.connections
        WHERE status = 'accepted'
        AND (
            (user_id_1 = auth.uid() AND user_id_2 = other_user_id) OR
            (user_id_1 = other_user_id AND user_id_2 = auth.uid())
        )
    ) THEN
        RAISE EXCEPTION 'Users must have an accepted connection to create a chat';
    END IF;

    -- MSG-001: Acquire transaction-level advisory lock on the unique pair
    -- to serialize concurrent calls from the two users and prevent duplicate chat rows.
    -- hashtext yields a 32-bit int.
    v_lock_key := hashtext(least(auth.uid()::text, other_user_id::text) || greatest(auth.uid()::text, other_user_id::text));
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Look for existing chat where both are participants
    SELECT c.id INTO v_chat_id
    FROM public.direct_chats c
    JOIN public.direct_chat_participants p1 ON p1.chat_id = c.id AND p1.user_id = auth.uid()
    JOIN public.direct_chat_participants p2 ON p2.chat_id = c.id AND p2.user_id = other_user_id;

    -- If not found, create new chat
    IF v_chat_id IS NULL THEN
        INSERT INTO public.direct_chats DEFAULT VALUES RETURNING id INTO v_chat_id;
        
        INSERT INTO public.direct_chat_participants (chat_id, user_id) 
        VALUES (v_chat_id, auth.uid()), (v_chat_id, other_user_id);
    END IF;

    RETURN v_chat_id;
END;
$$;
