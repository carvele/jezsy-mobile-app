-- Migration: 20260921165000_allow_authenticated_delete_notifications.sql
-- Description: Allow authenticated users to delete their own notifications from the inbox.

BEGIN;

-- 1. Grant DELETE privilege on notifications table to authenticated role
GRANT DELETE ON public.notifications TO authenticated;

-- 2. Create RLS DELETE policy for authenticated users
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

CREATE POLICY "Users can delete their own notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (((SELECT auth.uid()) = user_id));

COMMIT;
