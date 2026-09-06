-- MSG-004: Add DELETE policy on messages so staff/owner can explicitly delete
-- individual messages (e.g. moderation). Without this policy, RLS blocks all
-- DELETE on the table for every role. Cascade deletes triggered by FK from
-- conversations bypass RLS and already work; this policy closes the gap for
-- direct deletes initiated by staff/owner from the admin dashboard.
CREATE POLICY "Staff can delete messages"
  ON public.messages FOR DELETE
  USING (is_staff_or_admin());
