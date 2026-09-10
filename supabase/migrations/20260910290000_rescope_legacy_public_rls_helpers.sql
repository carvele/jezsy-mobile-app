-- Migration: 20260910290000_rescope_legacy_public_rls_helpers
-- Post-F3 Helper Cleanup Stage 1: Re-scope 19 legacy TO public policies to TO authenticated
-- Uses ALTER POLICY ... TO authenticated to preserve policy names, commands, permissive modes,
-- USING predicates, and WITH CHECK expressions identically by construction.
-- Function EXECUTE privileges on is_staff_or_admin() and is_admin_or_owner() remain granted to anon in Stage 1.

-- ============================================================================
-- 1. admin_notifications (1 policy)
-- ============================================================================
ALTER POLICY "Admins can manage admin notifications"
  ON public.admin_notifications
  TO authenticated;

-- ============================================================================
-- 2. conversations (3 policies)
-- ============================================================================
ALTER POLICY "Enable insert for own conversation or admin"
  ON public.conversations
  TO authenticated;

ALTER POLICY "Enable select for own conversation or admin"
  ON public.conversations
  TO authenticated;

ALTER POLICY "Enable update for own conversation or admin"
  ON public.conversations
  TO authenticated;

-- ============================================================================
-- 3. logs (1 policy)
-- ============================================================================
ALTER POLICY "Staff or admin can view logs"
  ON public.logs
  TO authenticated;

-- ============================================================================
-- 4. messages (4 policies)
-- ============================================================================
ALTER POLICY "Staff can delete messages"
  ON public.messages
  TO authenticated;

ALTER POLICY "Enable insert for messages in own conversation or admin"
  ON public.messages
  TO authenticated;

ALTER POLICY "Enable select for messages in own conversation or admin"
  ON public.messages
  TO authenticated;

ALTER POLICY "Users can update their messages or mark as read"
  ON public.messages
  TO authenticated;

-- ============================================================================
-- 5. reservation_items (4 policies)
-- ============================================================================
ALTER POLICY "Enable delete for admin and owner"
  ON public.reservation_items
  TO authenticated;

ALTER POLICY "Enable insert for admin only"
  ON public.reservation_items
  TO authenticated;

ALTER POLICY "Enable select for own reservation items or staff"
  ON public.reservation_items
  TO authenticated;

ALTER POLICY "Enable update for admin only"
  ON public.reservation_items
  TO authenticated;

-- ============================================================================
-- 6. reservations (4 policies)
-- ============================================================================
ALTER POLICY "Enable delete for admin and owner"
  ON public.reservations
  TO authenticated;

ALTER POLICY "Enable insert for admin only"
  ON public.reservations
  TO authenticated;

ALTER POLICY "Enable select for own reservations or admin"
  ON public.reservations
  TO authenticated;

ALTER POLICY "Enable update for admin only"
  ON public.reservations
  TO authenticated;

-- ============================================================================
-- 7. reviews (1 policy)
-- ============================================================================
ALTER POLICY "Customers can insert reviews for reserved products"
  ON public.reviews
  TO authenticated;

-- ============================================================================
-- 8. user_measurements (1 policy)
-- ============================================================================
ALTER POLICY "Enable all access for own measurements or admin"
  ON public.user_measurements
  TO authenticated;
