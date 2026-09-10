-- Migration: 20260910200000_optimize_auth_rls_initplans.sql
-- Optimizes 11 RLS policies flagged under auth_rls_initplan by replacing
-- volatile auth.uid() function evaluations with scalar subqueries (select auth.uid()).
-- All modifications are executed in-place via ALTER POLICY to preserve policy metadata.
-- Scopes direct-chat policies and staff connection policy to 'authenticated' so anon
-- receives clean 0-row denial without evaluating caller-bound helpers.

-- 1. Table: public.capsules
ALTER POLICY "Users can view own capsules"
  ON public.capsules
  USING ((select auth.uid()) = user_id);

-- 2. Table: public.capsule_items
ALTER POLICY "Users can insert own capsule items"
  ON public.capsule_items
  WITH CHECK (
    (capsule_id IN (
      SELECT capsules.id
      FROM public.capsules
      WHERE capsules.user_id = (select auth.uid())
    ))
    AND
    (wardrobe_item_id IN (
      SELECT wardrobe_items.id
      FROM public.wardrobe_items
      WHERE wardrobe_items.user_id = (select auth.uid())
    ))
  );

-- 3. Table: public.connections (SELECT)
ALTER POLICY "Users can view their non-blocked connections"
  ON public.connections
  USING (
    (((select auth.uid()) = user_id_1) OR ((select auth.uid()) = user_id_2))
    AND (NOT ((status = 'blocked'::text) AND (action_user_id <> (select auth.uid()))))
  );

-- 4. Table: public.connections (INSERT)
ALTER POLICY "Users can insert pending connections"
  ON public.connections
  WITH CHECK (
    (((select auth.uid()) = user_id_1) OR ((select auth.uid()) = user_id_2))
    AND ((select auth.uid()) = action_user_id)
    AND (status = ANY (ARRAY['pending'::text, 'blocked'::text]))
  );

-- 5. Table: public.connections (UPDATE)
ALTER POLICY "Users can update their connections"
  ON public.connections
  USING (
    (((select auth.uid()) = user_id_1) OR ((select auth.uid()) = user_id_2))
    AND (NOT ((status = 'blocked'::text) AND (action_user_id <> (select auth.uid()))))
  )
  WITH CHECK (
    (((select auth.uid()) = user_id_1) OR ((select auth.uid()) = user_id_2))
    AND (action_user_id = (select auth.uid()))
  );

-- 6. Table: public.connections (Staff SELECT)
ALTER POLICY "Staff can view all connections"
  ON public.connections
  TO authenticated;

-- 7. Table: public.direct_chats (SELECT)
ALTER POLICY "Users can view chats they are in"
  ON public.direct_chats
  TO authenticated
  USING (
    public.is_chat_participant(id, (select auth.uid()))
  );

-- 8. Table: public.direct_chats (INSERT)
ALTER POLICY "Users can create chats"
  ON public.direct_chats
  TO authenticated
  WITH CHECK (
    (select auth.uid()) IS NOT NULL
  );

-- 9. Table: public.direct_chat_participants (SELECT)
ALTER POLICY "Users can view participants of their chats"
  ON public.direct_chat_participants
  TO authenticated
  USING (
    (user_id = (select auth.uid()))
    OR public.is_chat_participant(chat_id, (select auth.uid()))
  );

-- 10. Table: public.direct_chat_participants (INSERT)
ALTER POLICY "Users can add participants if mutual connection exists"
  ON public.direct_chat_participants
  TO authenticated
  WITH CHECK (
    ((select auth.uid()) = user_id)
    OR (EXISTS (
      SELECT 1
      FROM public.connections c
      WHERE c.status = 'accepted'::text
        AND (
          ((c.user_id_1 = (select auth.uid())) AND (c.user_id_2 = direct_chat_participants.user_id))
          OR
          ((c.user_id_1 = direct_chat_participants.user_id) AND (c.user_id_2 = (select auth.uid())))
        )
    ))
  );

-- 11. Table: public.direct_messages (SELECT)
ALTER POLICY "Users can read their direct messages"
  ON public.direct_messages
  TO authenticated
  USING (
    public.is_chat_participant(chat_id, (select auth.uid()))
  );

-- 12. Table: public.direct_messages (INSERT)
ALTER POLICY "Users can send messages to connections"
  ON public.direct_messages
  TO authenticated
  WITH CHECK (
    (sender_id = (select auth.uid()))
    AND public.is_chat_participant(chat_id, (select auth.uid()))
    AND (EXISTS (
      SELECT 1
      FROM (public.direct_chat_participants other_p
        JOIN public.connections c ON (
          (c.status = 'accepted'::text) AND (
            ((c.user_id_1 = (select auth.uid())) AND (c.user_id_2 = other_p.user_id))
            OR
            ((c.user_id_1 = other_p.user_id) AND (c.user_id_2 = (select auth.uid())))
          )
        )
      )
      WHERE (
        (other_p.chat_id = direct_messages.chat_id)
        AND (other_p.user_id <> (select auth.uid()))
      )
    ))
  );
