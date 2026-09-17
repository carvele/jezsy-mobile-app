-- Migration: 20260917180000_customer_cancellation_and_return_refund
-- Implements:
-- 1. Dedicated return_refund_requests table for customer return/refund submissions
-- 2. Storage bucket 'return-refund-evidence' with scoped authenticated access
-- 3. public.is_reservation_return_eligible helper
-- 4. public.request_customer_refund RPC
-- 5. public.cancel_customer_reservation RPC
-- 6. public.review_return_refund_request RPC for staff/admin review

-- ============================================================================
-- 1. Table: return_refund_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.return_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason_category text NOT NULL,
  details text,
  photo_path text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected', 'refunded')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_refund_requests_res_id
  ON public.return_refund_requests (reservation_id);

CREATE INDEX IF NOT EXISTS idx_return_refund_requests_cust_id
  ON public.return_refund_requests (customer_id);

CREATE INDEX IF NOT EXISTS idx_return_refund_requests_status
  ON public.return_refund_requests (status);

-- Invariant: at most one unresolved request per reservation
CREATE UNIQUE INDEX IF NOT EXISTS return_refund_requests_one_active_per_reservation
  ON public.return_refund_requests (reservation_id)
  WHERE status IN ('submitted', 'under_review', 'approved');

-- Enable RLS
ALTER TABLE public.return_refund_requests ENABLE ROW LEVEL SECURITY;

-- Customers can view their own requests
CREATE POLICY "Customers can view own return refund requests"
  ON public.return_refund_requests
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- Staff or admins can view all return refund requests
CREATE POLICY "Staff can view all return refund requests"
  ON public.return_refund_requests
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- Staff or admins can update return refund requests
CREATE POLICY "Staff can update return refund requests"
  ON public.return_refund_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- ============================================================================
-- 2. Storage Bucket: return-refund-evidence
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('return-refund-evidence', 'return-refund-evidence', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Auth upload to own return-refund-evidence folder" ON storage.objects;
CREATE POLICY "Auth upload to own return-refund-evidence folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'return-refund-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Auth read own or staff read return-refund-evidence" ON storage.objects;
CREATE POLICY "Auth read own or staff read return-refund-evidence"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'return-refund-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff_or_admin()
    )
  );

DROP POLICY IF EXISTS "Auth delete own return-refund-evidence" ON storage.objects;
CREATE POLICY "Auth delete own return-refund-evidence"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'return-refund-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 3. Settings default for returnRequestWindow
-- ============================================================================
INSERT INTO public.settings (key, value)
VALUES ('returnRequestWindow', jsonb_build_object('days', 7))
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4. Helper Function: is_reservation_return_eligible
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_reservation_return_eligible(_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 
DECLARE
  v_res reservations%rowtype;
  v_window_days integer := 7;
  v_anchor timestamptz;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = _reservation_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF lower(trim(coalesce(v_res.status, ''))) <> 'completed' THEN
    RETURN false;
  END IF;

  BEGIN
    SELECT (value->>'days')::integer INTO v_window_days
    FROM settings WHERE key = 'returnRequestWindow';
    IF v_window_days IS NULL OR v_window_days <= 0 THEN
      v_window_days := 7;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_window_days := 7;
  END;

  v_anchor := coalesce(v_res.completed_at, v_res.date::timestamptz);
  IF v_anchor IS NULL THEN RETURN false; END IF;

  RETURN (now() - v_anchor) <= (v_window_days || ' days')::interval;
END;
;

REVOKE ALL ON FUNCTION public.is_reservation_return_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_reservation_return_eligible(uuid) TO authenticated, anon;

-- ============================================================================
-- 5. RPC: request_customer_refund
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_customer_refund(
  _reservation_id uuid,
  _reason_category text,
  _details text DEFAULT NULL,
  _photo_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 
DECLARE
  v_actor uuid := auth.uid();
  v_res reservations%rowtype;
  v_req return_refund_requests%rowtype;
  v_trimmed_reason text := trim(coalesce(_reason_category, ''));
  v_display text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF v_trimmed_reason = '' THEN
    RAISE EXCEPTION 'Reason category is required.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_res.customer_id <> v_actor THEN
    RAISE EXCEPTION 'You do not own this reservation.' USING ERRCODE = '42501';
  END IF;

  IF lower(trim(coalesce(v_res.status, ''))) <> 'completed' THEN
    RAISE EXCEPTION 'Only completed reservations can request a return or refund.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.is_reservation_return_eligible(_reservation_id) THEN
    RAISE EXCEPTION 'The return request window for this reservation has expired.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM return_refund_requests
    WHERE reservation_id = _reservation_id
      AND status IN ('submitted', 'under_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'An active return or refund request already exists for this reservation.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO return_refund_requests (
    reservation_id,
    customer_id,
    reason_category,
    details,
    photo_path,
    status
  )
  VALUES (
    _reservation_id,
    v_actor,
    v_trimmed_reason,
    nullif(trim(_details), ''),
    nullif(trim(_photo_path), ''),
    'submitted'
  )
  RETURNING * INTO v_req;

  v_display := coalesce(v_res.display_id, substring(_reservation_id::text from 1 for 8));

  INSERT INTO admin_notifications (title, message, type)
  VALUES (
    'New return/refund request',
    'Customer requested return/refund for reservation #' || v_display || '.',
    'ReturnRequest'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req.id,
    'status', v_req.status,
    'submitted_at', v_req.submitted_at
  );
END;
;

REVOKE ALL ON FUNCTION public.request_customer_refund(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_customer_refund(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 6. RPC: cancel_customer_reservation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_customer_reservation(
  _reservation_id uuid,
  _reason text DEFAULT 'Cancelled by customer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 
DECLARE
  v_actor uuid := auth.uid();
  v_res reservations%rowtype;
  v_status text;
  v_pstatus text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_res.customer_id <> v_actor THEN
    RAISE EXCEPTION 'You do not own this reservation.' USING ERRCODE = '42501';
  END IF;

  v_status := lower(trim(coalesce(v_res.status, '')));
  v_pstatus := lower(trim(coalesce(v_res.payment_status, '')));

  -- Idempotency check: if already cancelled, return success
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true);
  END IF;

  IF v_status NOT IN ('to pay', 'confirmed') THEN
    RAISE EXCEPTION 'Only reservations awaiting payment can be cancelled.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_pstatus IN ('paid', 'deposit paid', 'partially paid', 'submitted', 'processing', 'refund required', 'refunded') THEN
    RAISE EXCEPTION 'A reservation with payment activity cannot be cancelled directly.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.reservation_id = _reservation_id
      AND lower(trim(coalesce(p.status, ''))) IN ('paid', 'processing')
  ) THEN
    RAISE EXCEPTION 'Payment in progress; cannot cancel.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE reservations
  SET status = 'Cancelled',
      cancellation_reason = coalesce(nullif(trim(_reason), ''), 'Cancelled by customer'),
      updated_at = now()
  WHERE id = _reservation_id;

  -- The existing trigger trg_apply_inventory_on_reservation_status
  -- fires on UPDATE of status to 'Cancelled' and restores reserved inventory automatically.

  RETURN jsonb_build_object('success', true, 'reservation_id', _reservation_id);
END;
;

REVOKE ALL ON FUNCTION public.cancel_customer_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_customer_reservation(uuid, text) TO authenticated;

-- ============================================================================
-- 7. RPC: review_return_refund_request (Staff/Admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.review_return_refund_request(
  _request_id uuid,
  _decision text,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 
DECLARE
  v_actor uuid := auth.uid();
  v_req return_refund_requests%rowtype;
  v_normalized_decision text := lower(trim(coalesce(_decision, '')));
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Staff or admin authorization required.' USING ERRCODE = '42501';
  END IF;

  IF v_normalized_decision NOT IN ('approve', 'reject', 'under_review') THEN
    RAISE EXCEPTION 'Invalid decision. Must be approve, reject, or under_review.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_req FROM return_refund_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status IN ('approved', 'refunded') THEN
    RAISE EXCEPTION 'Request has already been approved or refunded.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_normalized_decision = 'approve' THEN
    UPDATE return_refund_requests
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_actor,
        resolution_notes = nullif(trim(_notes), ''),
        updated_at = now()
    WHERE id = _request_id;

    -- Update reservation payment_status to 'Refund Required'
    UPDATE reservations
    SET payment_status = 'Refund Required',
        updated_at = now()
    WHERE id = v_req.reservation_id;

  ELSIF v_normalized_decision = 'reject' THEN
    UPDATE return_refund_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = v_actor,
        resolution_notes = nullif(trim(_notes), ''),
        updated_at = now()
    WHERE id = _request_id;

  ELSIF v_normalized_decision = 'under_review' THEN
    UPDATE return_refund_requests
    SET status = 'under_review',
        resolution_notes = nullif(trim(_notes), ''),
        updated_at = now()
    WHERE id = _request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', _request_id,
    'decision', v_normalized_decision
  );
END;
;

REVOKE ALL ON FUNCTION public.review_return_refund_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_return_refund_request(uuid, text, text) TO authenticated;
