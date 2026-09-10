-- Migration: 20260910240000_remediate_mpp_batch_f3
-- Remediation for Pass F - Batch F3 multiple permissive policies
-- Applies to 7 tables:
--   account_deletion_requests, ar_sessions, feedback, inventory, payments, profiles, stock_notify_requests
--
-- MPP Findings Remediated: 10 -> 0
-- auth_rls_initplan: preserved at 0 via (SELECT auth.uid()) / (SELECT auth.jwt())
-- F3-PROFILES-INSERT: Approved intentional authorization tightening (UID + JWT email binding)
-- Preserves write denial for staff on stock_notify_requests and SELECT denial for customers on ar_sessions/feedback.

-- ============================================================================
-- 1. account_deletion_requests
-- ============================================================================
DROP POLICY IF EXISTS "Staff manage deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users withdraw own pending deletion request" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users read own deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Users file own deletion request" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Account deletion requests select" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Account deletion requests insert" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Account deletion requests update" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Account deletion requests delete" ON public.account_deletion_requests;

CREATE POLICY "Account deletion requests select"
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = user_id
  );

CREATE POLICY "Account deletion requests insert"
  ON public.account_deletion_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff_or_admin()
  );

CREATE POLICY "Account deletion requests update"
  ON public.account_deletion_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "Account deletion requests delete"
  ON public.account_deletion_requests
  FOR DELETE
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (
      (SELECT auth.uid()) = user_id
      AND status = 'pending'
    )
  );

-- ============================================================================
-- 2. ar_sessions
-- ============================================================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.ar_sessions;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.ar_sessions;
DROP POLICY IF EXISTS "AR sessions select" ON public.ar_sessions;
DROP POLICY IF EXISTS "AR sessions insert" ON public.ar_sessions;
DROP POLICY IF EXISTS "AR sessions update" ON public.ar_sessions;
DROP POLICY IF EXISTS "AR sessions delete" ON public.ar_sessions;

CREATE POLICY "AR sessions select"
  ON public.ar_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

CREATE POLICY "AR sessions insert"
  ON public.ar_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = user_id
  );

CREATE POLICY "AR sessions update"
  ON public.ar_sessions
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "AR sessions delete"
  ON public.ar_sessions
  FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

-- ============================================================================
-- 3. feedback
-- ============================================================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.feedback;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.feedback;
DROP POLICY IF EXISTS "Feedback select" ON public.feedback;
DROP POLICY IF EXISTS "Feedback insert" ON public.feedback;
DROP POLICY IF EXISTS "Feedback update" ON public.feedback;
DROP POLICY IF EXISTS "Feedback delete" ON public.feedback;

CREATE POLICY "Feedback select"
  ON public.feedback
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

CREATE POLICY "Feedback insert"
  ON public.feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = user_id
  );

CREATE POLICY "Feedback update"
  ON public.feedback
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "Feedback delete"
  ON public.feedback
  FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

-- ============================================================================
-- 4. inventory
-- ============================================================================
DROP POLICY IF EXISTS "Enable owner access for inventory" ON public.inventory;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.inventory;
DROP POLICY IF EXISTS "Inventory select" ON public.inventory;
DROP POLICY IF EXISTS "Inventory insert" ON public.inventory;
DROP POLICY IF EXISTS "Inventory update" ON public.inventory;
DROP POLICY IF EXISTS "Inventory delete" ON public.inventory;

CREATE POLICY "Inventory select"
  ON public.inventory
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Inventory insert"
  ON public.inventory
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Inventory update"
  ON public.inventory
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

CREATE POLICY "Inventory delete"
  ON public.inventory
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_owner());

-- ============================================================================
-- 5. payments
-- ============================================================================
DROP POLICY IF EXISTS "Staff read all payments" ON public.payments;
DROP POLICY IF EXISTS "Users read own payments" ON public.payments;
DROP POLICY IF EXISTS "Payments select" ON public.payments;

CREATE POLICY "Payments select"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = user_id
  );

-- ============================================================================
-- 6. profiles
-- ============================================================================
DROP POLICY IF EXISTS "Enable all access for admin/staff" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;
DROP POLICY IF EXISTS "restrict_profile_insert_to_own_auth" ON public.profiles;
DROP POLICY IF EXISTS "Enable read for own profile or admin" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.profiles;
DROP POLICY IF EXISTS "Profiles select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles insert" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update" ON public.profiles;
DROP POLICY IF EXISTS "Profiles delete" ON public.profiles;

CREATE POLICY "Profiles select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = id
  );

CREATE POLICY "Profiles insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff_or_admin()
    OR (
      (SELECT auth.uid()) = id
      AND email = ((SELECT auth.jwt()) ->> 'email')
    )
  );

CREATE POLICY "Profiles update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = id
  )
  WITH CHECK (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = id
  );

CREATE POLICY "Profiles delete"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_staff_or_admin());

-- ============================================================================
-- 7. stock_notify_requests
-- ============================================================================
DROP POLICY IF EXISTS "Users manage own stock notify requests" ON public.stock_notify_requests;
DROP POLICY IF EXISTS "Staff and admin can read all stock notify requests" ON public.stock_notify_requests;
DROP POLICY IF EXISTS "Stock notify requests select" ON public.stock_notify_requests;
DROP POLICY IF EXISTS "Stock notify requests insert" ON public.stock_notify_requests;
DROP POLICY IF EXISTS "Stock notify requests update" ON public.stock_notify_requests;
DROP POLICY IF EXISTS "Stock notify requests delete" ON public.stock_notify_requests;

CREATE POLICY "Stock notify requests select"
  ON public.stock_notify_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_staff_or_admin()
    OR (SELECT auth.uid()) = user_id
  );

CREATE POLICY "Stock notify requests insert"
  ON public.stock_notify_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
  );

CREATE POLICY "Stock notify requests update"
  ON public.stock_notify_requests
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
  );

CREATE POLICY "Stock notify requests delete"
  ON public.stock_notify_requests
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
  );
