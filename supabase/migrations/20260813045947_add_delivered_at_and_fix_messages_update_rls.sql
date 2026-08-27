-- Adds a delivered_at column to public.messages for a real "Delivered"
-- status between Sent and Seen, and fixes a pre-existing RLS gap found
-- while wiring it up.
--
-- The messages UPDATE policy checked
--   profiles.role = ANY(ARRAY['owner'])
-- directly, instead of the shared is_staff_or_admin() helper the INSERT and
-- SELECT policies on this same table already use. is_staff_or_admin()
-- includes 'staff'; the inline check did not. Live data at the time of this
-- migration: 8 profiles with role='staff' vs 1 'owner' -- so the large
-- majority of real staff accounts have been silently unable to mark
-- messages read, edit their own sent messages, or (going forward) mark
-- delivered_at. The update simply matched zero rows under RLS with no
-- error, so this never surfaced as a visible failure.

DROP POLICY IF EXISTS "Users can update their messages or mark as read" ON public.messages;
CREATE POLICY "Users can update their messages or mark as read" ON public.messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND (c.customer_id = auth.uid() OR public.is_staff_or_admin())
  )
);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
