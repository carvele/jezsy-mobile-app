-- Rollback for 20260813045947_add_delivered_at_and_fix_messages_update_rls.sql
-- Restores the narrower admin/owner-only UPDATE policy and drops
-- delivered_at. Re-introduces the staff-role RLS gap this migration fixed --
-- only use this rollback if the delivered_at feature itself needs to be
-- fully reverted, not merely to "undo" the RLS fix.

DROP POLICY IF EXISTS "Users can update their messages or mark as read" ON public.messages;
CREATE POLICY "Users can update their messages or mark as read" ON public.messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND (c.customer_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])
      ))
  )
);

ALTER TABLE public.messages DROP COLUMN IF EXISTS delivered_at;
