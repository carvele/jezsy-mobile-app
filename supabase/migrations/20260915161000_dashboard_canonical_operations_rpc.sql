-- Canonical Dashboard Operational RPCs
-- Migration: 20260915161000_dashboard_canonical_operations_rpc.sql

-- 1. Operations Domain RPC: get_dashboard_operations
CREATE OR REPLACE FUNCTION public.get_dashboard_operations(
  p_today_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_unique_actions integer := 0;
  v_awaiting_payment integer := 0;
  v_receipt_review integer := 0;
  v_preparing integer := 0;
  v_ready_pickup integer := 0;
  v_refund_required integer := 0;
  v_pending_refund_amount numeric(12,2) := 0;
  v_pending_refund_count integer := 0;
  v_today_schedule jsonb := '[]'::jsonb;
BEGIN
  -- Strict Timezone Assertion (Fails closed on non-Asia/Manila)
  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported dashboard timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  -- Workforce RBAC Security Guard
  v_uid := auth.uid();
  PERFORM public.assert_analytics_access(v_uid);

  -- Manila Business Day [today 00:00:00, tomorrow 00:00:00) converted to UTC
  v_start_utc := (p_today_date::text || ' 00:00:00 ' || p_timezone)::timestamptz;
  v_end_utc := ((p_today_date + 1)::text || ' 00:00:00 ' || p_timezone)::timestamptz;

  -- Authoritative Deduplicated Action Queues CTE
  WITH awaiting_payment_res AS (
    SELECT r.id
    FROM public.reservations r
    WHERE r.status = 'To Pay'
      AND coalesce(r.deleted, false) = false
  ),
  receipt_review_res AS (
    SELECT r.id
    FROM public.reservations r
    WHERE (r.payment_status = 'processing' OR r.balance_payment_status = 'processing')
      AND coalesce(r.deleted, false) = false
  ),
  preparing_res AS (
    SELECT r.id
    FROM public.reservations r
    WHERE r.status = 'Preparing'
      AND coalesce(r.deleted, false) = false
  ),
  ready_pickup_res AS (
    SELECT r.id
    FROM public.reservations r
    WHERE r.status = 'To Pickup'
      AND coalesce(r.deleted, false) = false
  ),
  refund_res AS (
    SELECT DISTINCT r.id
    FROM public.reservations r
    JOIN public.payments p ON p.reservation_id = r.id
    WHERE r.status = 'Cancelled'
      AND coalesce(r.deleted, false) = false
      AND p.status = 'paid'
      AND coalesce(p.requires_refund, false) = true
  ),
  all_actions_res AS (
    SELECT id FROM awaiting_payment_res
    UNION
    SELECT id FROM receipt_review_res
    UNION
    SELECT id FROM preparing_res
    UNION
    SELECT id FROM ready_pickup_res
    UNION
    SELECT id FROM refund_res
  )
  SELECT
    (SELECT count(*) FROM all_actions_res),
    (SELECT count(*) FROM awaiting_payment_res),
    (SELECT count(*) FROM receipt_review_res),
    (SELECT count(*) FROM preparing_res),
    (SELECT count(*) FROM ready_pickup_res),
    (SELECT count(*) FROM refund_res)
  INTO
    v_unique_actions,
    v_awaiting_payment,
    v_receipt_review,
    v_preparing,
    v_ready_pickup,
    v_refund_required;

  -- Pending Refund Liability (Exact Analytics Predicate)
  SELECT
    coalesce(sum(p.amount_centavos) / 100.0, 0),
    count(DISTINCT r.id)
  INTO
    v_pending_refund_amount,
    v_pending_refund_count
  FROM public.reservations r
  JOIN public.payments p ON p.reservation_id = r.id
  WHERE r.status = 'Cancelled'
    AND coalesce(p.requires_refund, false) = true
    AND coalesce(r.deleted, false) = false
    AND p.status = 'paid';

  -- Today's Schedule in Asia/Manila (Ordered by appointment time, Cancelled excluded)
  SELECT coalesce(jsonb_agg(today_item), '[]'::jsonb)
  INTO v_today_schedule
  FROM (
    SELECT
      r.id,
      r.display_id,
      r.customer_id,
      r.customer_name,
      r.product_id,
      r.product_name,
      r.size,
      r.color,
      r.status,
      r.payment_status,
      r.date,
      r.appointment_time,
      to_char(r.appointment_time AT TIME ZONE p_timezone, 'HH12:MI AM') as appointment_time_formatted
    FROM public.reservations r
    WHERE r.date >= v_start_utc
      AND r.date < v_end_utc
      AND r.status <> 'Cancelled'
      AND coalesce(r.deleted, false) = false
    ORDER BY coalesce(r.appointment_time, r.date) ASC, r.date ASC
  ) today_item;

  RETURN jsonb_build_object(
    'business_date', p_today_date::text,
    'timezone', p_timezone,
    'action_queues', jsonb_build_object(
      'unique_action_count', v_unique_actions,
      'awaiting_payment', v_awaiting_payment,
      'receipt_review', v_receipt_review,
      'preparing', v_preparing,
      'ready_for_pickup', v_ready_pickup,
      'refund_required', v_refund_required
    ),
    'pending_refund_liability', jsonb_build_object(
      'amount', v_pending_refund_amount,
      'count', v_pending_refund_count
    ),
    'today_schedule', v_today_schedule
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_operations(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_operations(date, text) TO authenticated;

-- 2. Inventory Domain RPC: get_top_inventory_alerts
CREATE OR REPLACE FUNCTION public.get_top_inventory_alerts(
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_threshold integer;
  v_result jsonb;
BEGIN
  -- Workforce RBAC Security Guard
  v_uid := auth.uid();
  PERFORM public.assert_analytics_access(v_uid);

  v_threshold := public.low_stock_threshold();

  SELECT coalesce(jsonb_agg(alert_row), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      i.id as inventory_id,
      i.product_doc_id as product_id,
      i.sku,
      coalesce(p.name, i.item, 'Unknown Product') as product_name,
      i.color,
      i.size,
      i.available,
      i.reserved,
      i.total,
      CASE
        WHEN i.available = 0 THEN 'out_of_stock'
        WHEN i.available > 0 AND i.available <= v_threshold THEN 'low_stock'
        ELSE 'in_stock'
      END as stock_tier,
      p.image_url
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.product_doc_id
    WHERE coalesce(i.deleted, false) = false
      AND (i.available = 0 OR (i.available > 0 AND i.available <= v_threshold))
    ORDER BY i.available ASC, i.total DESC, i.id ASC
    LIMIT p_limit
  ) alert_row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_inventory_alerts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_inventory_alerts(integer) TO authenticated;

-- 3. Activity Domain RPC: get_recent_dashboard_activity
CREATE OR REPLACE FUNCTION public.get_recent_dashboard_activity(
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_result jsonb;
BEGIN
  -- Workforce RBAC Security Guard
  v_uid := auth.uid();
  PERFORM public.assert_analytics_access(v_uid);

  SELECT coalesce(jsonb_agg(act_row), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      l.id,
      l.user_id,
      l.user_name,
      l.action,
      l.target_type,
      l.target_id,
      l.details,
      l.timestamp
    FROM public.logs l
    WHERE l.target_type IN ('reservation', 'product', 'inventory', 'customer', 'profile')
      AND l.action NOT ILIKE '%role%'
      AND l.action NOT ILIKE '%mfa%'
      AND l.action NOT ILIKE '%password%'
      AND l.action NOT ILIKE '%device%'
      AND l.action NOT ILIKE '%auth%'
      AND l.action NOT ILIKE '%permission%'
      AND l.action NOT ILIKE '%security%'
    ORDER BY l.timestamp DESC
    LIMIT p_limit
  ) act_row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recent_dashboard_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_dashboard_activity(integer) TO authenticated;
