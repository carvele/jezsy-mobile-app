-- Feature: customer-initiated account deletion request.
--
-- Deliberately a request queue, not a delete. Erasing an account would have to
-- cascade through reservations, orders and stock movements, which are business
-- records the shop still needs; standard practice is to file the request and
-- let staff process it. The owner-dashboard repo owns that processing surface.
--
-- No SECURITY DEFINER RPC here: unlike create_order there is no price or
-- ownership vector to protect, so a direct INSERT policy keyed on auth.uid()
-- is sufficient and is the same shape as stock_notify_requests.

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reason text,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    processed_at timestamptz,
    processed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT account_deletion_requests_status_check
      CHECK (status IN ('pending', 'completed', 'cancelled'))
);

-- Partial, so a completed or cancelled request does not block a later one.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_open
  ON public.account_deletion_requests (user_id)
  WHERE status = 'pending';

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Users read own deletion requests"
  ON public.account_deletion_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- status is pinned in the check so a customer cannot file a row that is
-- already marked processed.
DROP POLICY IF EXISTS "Users file own deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users file own deletion request"
  ON public.account_deletion_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Users withdraw own pending deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users withdraw own pending deletion request"
  ON public.account_deletion_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Staff manage deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Staff manage deletion requests"
  ON public.account_deletion_requests FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());
