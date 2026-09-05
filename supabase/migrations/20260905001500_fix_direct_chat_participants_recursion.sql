-- Fix infinite recursion in RLS policies for direct_chat_participants, direct_chats, and direct_messages.
-- A table's RLS policy querying itself causes PostgreSQL error 42P17 (infinite recursion).
-- Using a SECURITY DEFINER helper function avoids self-referential RLS loops.

CREATE OR REPLACE FUNCTION public.is_chat_participant(p_chat_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.direct_chat_participants
    WHERE chat_id = p_chat_id AND user_id = p_user_id
  );
$$;

-- Fix direct_chat_participants SELECT policy
DROP POLICY IF EXISTS "Users can view participants of their chats" ON public.direct_chat_participants;

CREATE POLICY "Users can view participants of their chats"
ON public.direct_chat_participants FOR SELECT
TO public
USING (
  user_id = auth.uid() OR public.is_chat_participant(chat_id, auth.uid())
);

-- Fix direct_chats SELECT policy
DROP POLICY IF EXISTS "Users can view chats they are in" ON public.direct_chats;

CREATE POLICY "Users can view chats they are in"
ON public.direct_chats FOR SELECT
TO public
USING (
  public.is_chat_participant(id, auth.uid())
);

-- Fix direct_messages SELECT policy
DROP POLICY IF EXISTS "Users can read their direct messages" ON public.direct_messages;

CREATE POLICY "Users can read their direct messages"
ON public.direct_messages FOR SELECT
TO public
USING (
  public.is_chat_participant(chat_id, auth.uid())
);

-- Fix direct_messages INSERT policy
DROP POLICY IF EXISTS "Users can send messages to connections" ON public.direct_messages;

CREATE POLICY "Users can send messages to connections"
ON public.direct_messages FOR INSERT
TO public
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_chat_participant(chat_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.direct_chat_participants other_p
    JOIN public.connections c ON c.status = 'accepted' 
      AND (
        (c.user_id_1 = auth.uid() AND c.user_id_2 = other_p.user_id) OR
        (c.user_id_1 = other_p.user_id AND c.user_id_2 = auth.uid())
      )
    WHERE other_p.chat_id = direct_messages.chat_id 
    AND other_p.user_id != auth.uid()
  )
);

-- Fix direct_messages UPDATE policy
DROP POLICY IF EXISTS "Users can mark messages as read" ON public.direct_messages;

CREATE POLICY "Users can mark messages as read"
ON public.direct_messages FOR UPDATE
TO public
USING (
  public.is_chat_participant(chat_id, auth.uid())
)
WITH CHECK (
  sender_id = sender_id AND content = content AND chat_id = chat_id
);
