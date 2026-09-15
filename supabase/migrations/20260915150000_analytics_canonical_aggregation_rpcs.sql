-- Canonical Analytics Aggregation RPCs & Schema Additions
-- Migration: 20260915150000_analytics_canonical_aggregation_rpcs.sql

-- 1. Schema Additions: reservations.completed_at
ALTER TABLE public.reservations
ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reservations_completed_at
ON public.reservations (completed_at)
WHERE status = 'Completed';

-- Trigger to maintain completed_at on state transition to 'Completed'
CREATE OR REPLACE FUNCTION public.trg_set_reservation_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Completed' OR OLD.status IS NULL) THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_set_completed_at ON public.reservations;
CREATE TRIGGER trg_reservation_set_completed_at
BEFORE INSERT OR UPDATE OF status, completed_at ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_reservation_completed_at();

-- Backfill legacy Completed reservations where completed_at is NULL using created_at
UPDATE public.reservations
SET completed_at = created_at
WHERE status = 'Completed' AND completed_at IS NULL;

-- 2. Low-Stock Threshold Helper Function
CREATE OR REPLACE FUNCTION public.low_stock_threshold()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2;
$$;

REVOKE ALL ON FUNCTION public.low_stock_threshold() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.low_stock_threshold() TO authenticated;

-- 3. Analytics Workforce Authorization Helper
CREATE OR REPLACE FUNCTION public.assert_analytics_access(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'analytics_access_denied: unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_uid
      AND employment_status = 'active'
      AND coalesce(deleted, false) = false
      AND coalesce(is_blocked, false) = false
      AND role IN ('staff', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'analytics_access_denied: insufficient workforce privilege' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_analytics_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_analytics_access(uuid) TO authenticated;

-- 4. public.get_analytics_overview
CREATE OR REPLACE FUNCTION public.get_analytics_overview(
  p_start_date date,
  p_end_date_exclusive date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day_count integer;
  v_prev_start_date date;
  v_prev_end_date date;
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_prev_start_utc timestamptz;
  v_prev_end_utc timestamptz;

  -- Current period metrics
  v_curr_gross_cash numeric(12,2) := 0;
  v_curr_booking_value numeric(12,2) := 0;
  v_curr_completed_res integer := 0;
  v_curr_unique_cust integer := 0;
  v_curr_cancelled_res integer := 0;
  v_curr_cancellation_rate numeric(5,2) := NULL;

  -- Previous period metrics
  v_prev_gross_cash numeric(12,2) := 0;
  v_prev_booking_value numeric(12,2) := 0;
  v_prev_completed_res integer := 0;
  v_prev_unique_cust integer := 0;
  v_prev_cancelled_res integer := 0;
  v_prev_cancellation_rate numeric(5,2) := NULL;

  -- Snapshot metrics
  v_pending_refund_amount numeric(12,2) := 0;
  v_pending_refund_count integer := 0;
  v_avg_rating numeric(3,2) := NULL;
  v_review_count integer := 0;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported analytics timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL OR p_end_date_exclusive IS NULL OR p_end_date_exclusive <= p_start_date THEN
    RAISE EXCEPTION 'Invalid date range: start_date must precede end_date_exclusive' USING ERRCODE = '22023';
  END IF;

  v_day_count := p_end_date_exclusive - p_start_date;
  v_prev_start_date := p_start_date - v_day_count;
  v_prev_end_date := p_start_date;

  v_start_utc := p_start_date::timestamp AT TIME ZONE p_timezone;
  v_end_utc := p_end_date_exclusive::timestamp AT TIME ZONE p_timezone;
  v_prev_start_utc := v_prev_start_date::timestamp AT TIME ZONE p_timezone;
  v_prev_end_utc := v_prev_end_date::timestamp AT TIME ZONE p_timezone;

  -- Current Period Gross Cash Collected
  SELECT coalesce(sum(amount_centavos) / 100.0, 0)
  INTO v_curr_gross_cash
  FROM public.payments
  WHERE status = 'paid'
    AND created_at >= v_start_utc
    AND created_at < v_end_utc;

  -- Previous Period Gross Cash Collected
  SELECT coalesce(sum(amount_centavos) / 100.0, 0)
  INTO v_prev_gross_cash
  FROM public.payments
  WHERE status = 'paid'
    AND created_at >= v_prev_start_utc
    AND created_at < v_prev_end_utc;

  -- Current Period Completed Booking Value, Completed Reservations, and Cancelled Reservations
  SELECT
    coalesce(sum(rental_price) FILTER (WHERE status = 'Completed'), 0),
    count(*) FILTER (WHERE status = 'Completed'),
    count(*) FILTER (WHERE status = 'Cancelled')
  INTO
    v_curr_booking_value,
    v_curr_completed_res,
    v_curr_cancelled_res
  FROM public.reservations
  WHERE coalesce(deleted, false) = false
    AND (
      (status = 'Completed' AND coalesce(completed_at, created_at) >= v_start_utc AND coalesce(completed_at, created_at) < v_end_utc)
      OR (status = 'Cancelled' AND created_at >= v_start_utc AND created_at < v_end_utc)
    );

  -- Current Period Unique Customers Served (Completed reservations)
  SELECT count(DISTINCT customer_id)
  INTO v_curr_unique_cust
  FROM public.reservations
  WHERE coalesce(deleted, false) = false
    AND status = 'Completed'
    AND coalesce(completed_at, created_at) >= v_start_utc
    AND coalesce(completed_at, created_at) < v_end_utc;

  -- Previous Period Completed Booking Value, Completed Reservations, and Cancelled Reservations
  SELECT
    coalesce(sum(rental_price) FILTER (WHERE status = 'Completed'), 0),
    count(*) FILTER (WHERE status = 'Completed'),
    count(*) FILTER (WHERE status = 'Cancelled')
  INTO
    v_prev_booking_value,
    v_prev_completed_res,
    v_prev_cancelled_res
  FROM public.reservations
  WHERE coalesce(deleted, false) = false
    AND (
      (status = 'Completed' AND coalesce(completed_at, created_at) >= v_prev_start_utc AND coalesce(completed_at, created_at) < v_prev_end_utc)
      OR (status = 'Cancelled' AND created_at >= v_prev_start_utc AND created_at < v_prev_end_utc)
    );

  -- Previous Period Unique Customers Served
  SELECT count(DISTINCT customer_id)
  INTO v_prev_unique_cust
  FROM public.reservations
  WHERE coalesce(deleted, false) = false
    AND status = 'Completed'
    AND coalesce(completed_at, created_at) >= v_prev_start_utc
    AND coalesce(completed_at, created_at) < v_prev_end_utc;

  -- Cancellation Rates (resolved = completed + cancelled)
  IF (v_curr_completed_res + v_curr_cancelled_res) > 0 THEN
    v_curr_cancellation_rate := round((v_curr_cancelled_res::numeric / (v_curr_completed_res + v_curr_cancelled_res)::numeric) * 100.0, 2);
  END IF;

  IF (v_prev_completed_res + v_prev_cancelled_res) > 0 THEN
    v_prev_cancellation_rate := round((v_prev_cancelled_res::numeric / (v_prev_completed_res + v_prev_cancelled_res)::numeric) * 100.0, 2);
  END IF;

  -- Snapshot: Pending Refund Liability (all-time snapshot of Cancelled reservations with requires_refund = true)
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

  -- Snapshot: Average Product Rating from reviews (all-time)
  SELECT
    round(avg(rating)::numeric, 2),
    count(*)
  INTO
    v_avg_rating,
    v_review_count
  FROM public.reviews;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date_exclusive', p_end_date_exclusive,
      'timezone', p_timezone,
      'start_utc', v_start_utc,
      'end_utc', v_end_utc,
      'prev_start_date', v_prev_start_date,
      'prev_end_date', v_prev_end_date,
      'prev_start_utc', v_prev_start_utc,
      'prev_end_utc', v_prev_end_utc
    ),
    'gross_cash_collected', jsonb_build_object('current', v_curr_gross_cash, 'previous', v_prev_gross_cash),
    'completed_booking_value', jsonb_build_object('current', v_curr_booking_value, 'previous', v_prev_booking_value),
    'completed_reservations', jsonb_build_object('current', v_curr_completed_res, 'previous', v_prev_completed_res),
    'unique_customers_served', jsonb_build_object('current', v_curr_unique_cust, 'previous', v_prev_unique_cust),
    'cancellation_rate', jsonb_build_object(
      'current', v_curr_cancellation_rate,
      'previous', v_prev_cancellation_rate,
      'current_cancelled', v_curr_cancelled_res,
      'previous_cancelled', v_prev_cancelled_res
    ),
    'pending_refund_liability', jsonb_build_object(
      'amount', v_pending_refund_amount,
      'count', v_pending_refund_count
    ),
    'customer_satisfaction', jsonb_build_object(
      'average_rating', v_avg_rating,
      'review_count', v_review_count
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_overview(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_overview(date, date, text) TO authenticated;

-- 5. public.get_reservation_analytics
CREATE OR REPLACE FUNCTION public.get_reservation_analytics(
  p_start_date date,
  p_end_date_exclusive date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_status_breakdown jsonb;
  v_daily_trends jsonb;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported analytics timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  v_start_utc := p_start_date::timestamp AT TIME ZONE p_timezone;
  v_end_utc := p_end_date_exclusive::timestamp AT TIME ZONE p_timezone;

  -- Status breakdown within period (based on created_at for lifecycle discovery)
  SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', total_count) ORDER BY total_count DESC), '[]'::jsonb)
  INTO v_status_breakdown
  FROM (
    SELECT status, count(*) as total_count
    FROM public.reservations
    WHERE coalesce(deleted, false) = false
      AND created_at >= v_start_utc
      AND created_at < v_end_utc
    GROUP BY status
  ) sb;

  -- Daily reservation trends within period (created_at grouped by local date in p_timezone)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'date', day_series::date,
    'label', to_char(day_series, 'Mon DD'),
    'reservations', coalesce(t.total_count, 0),
    'completed', coalesce(t.completed_count, 0)
  ) ORDER BY day_series), '[]'::jsonb)
  INTO v_daily_trends
  FROM generate_series(p_start_date::timestamp, (p_end_date_exclusive - 1)::timestamp, interval '1 day') AS day_series
  LEFT JOIN (
    SELECT
      (created_at AT TIME ZONE p_timezone)::date as res_day,
      count(*) as total_count,
      count(*) FILTER (WHERE status = 'Completed') as completed_count
    FROM public.reservations
    WHERE coalesce(deleted, false) = false
      AND created_at >= v_start_utc
      AND created_at < v_end_utc
    GROUP BY res_day
  ) t ON t.res_day = day_series::date;

  RETURN jsonb_build_object(
    'status_breakdown', v_status_breakdown,
    'daily_trends', v_daily_trends
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reservation_analytics(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reservation_analytics(date, date, text) TO authenticated;

-- 6. public.get_cashflow_analytics
CREATE OR REPLACE FUNCTION public.get_cashflow_analytics(
  p_start_date date,
  p_end_date_exclusive date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_total_collected numeric(12,2) := 0;
  v_method_breakdown jsonb;
  v_purpose_breakdown jsonb;
  v_daily_cashflow jsonb;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported analytics timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  v_start_utc := p_start_date::timestamp AT TIME ZONE p_timezone;
  v_end_utc := p_end_date_exclusive::timestamp AT TIME ZONE p_timezone;

  -- Total gross cash collected
  SELECT coalesce(sum(amount_centavos) / 100.0, 0)
  INTO v_total_collected
  FROM public.payments
  WHERE status = 'paid'
    AND created_at >= v_start_utc
    AND created_at < v_end_utc;

  -- Breakdown by payment method
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'method', method,
    'total_amount', total_amt,
    'count', total_cnt
  ) ORDER BY total_amt DESC), '[]'::jsonb)
  INTO v_method_breakdown
  FROM (
    SELECT
      coalesce(method, 'unknown') as method,
      sum(amount_centavos) / 100.0 as total_amt,
      count(*) as total_cnt
    FROM public.payments
    WHERE status = 'paid'
      AND created_at >= v_start_utc
      AND created_at < v_end_utc
    GROUP BY method
  ) mb;

  -- Breakdown by purpose
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'purpose', purpose,
    'total_amount', total_amt,
    'count', total_cnt
  ) ORDER BY total_amt DESC), '[]'::jsonb)
  INTO v_purpose_breakdown
  FROM (
    SELECT
      coalesce(purpose, 'reservation') as purpose,
      sum(amount_centavos) / 100.0 as total_amt,
      count(*) as total_cnt
    FROM public.payments
    WHERE status = 'paid'
      AND created_at >= v_start_utc
      AND created_at < v_end_utc
    GROUP BY purpose
  ) pb;

  -- Daily cashflow trends
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'date', day_series::date,
    'label', to_char(day_series, 'Mon DD'),
    'amount', coalesce(cf.daily_amt, 0),
    'payments_count', coalesce(cf.cnt, 0)
  ) ORDER BY day_series), '[]'::jsonb)
  INTO v_daily_cashflow
  FROM generate_series(p_start_date::timestamp, (p_end_date_exclusive - 1)::timestamp, interval '1 day') AS day_series
  LEFT JOIN (
    SELECT
      (created_at AT TIME ZONE p_timezone)::date as pay_day,
      sum(amount_centavos) / 100.0 as daily_amt,
      count(*) as cnt
    FROM public.payments
    WHERE status = 'paid'
      AND created_at >= v_start_utc
      AND created_at < v_end_utc
    GROUP BY pay_day
  ) cf ON cf.pay_day = day_series::date;

  RETURN jsonb_build_object(
    'gross_cash_collected', v_total_collected,
    'method_breakdown', v_method_breakdown,
    'purpose_breakdown', v_purpose_breakdown,
    'daily_cashflow', v_daily_cashflow
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cashflow_analytics(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow_analytics(date, date, text) TO authenticated;

-- 7. public.get_inventory_health_analytics
CREATE OR REPLACE FUNCTION public.get_inventory_health_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_threshold integer := public.low_stock_threshold();
  v_available_units bigint := 0;
  v_reserved_units bigint := 0;
  v_in_stock_variants bigint := 0;
  v_low_stock_variants bigint := 0;
  v_out_of_stock_variants bigint := 0;
  v_total_variants bigint := 0;
  v_total_catalog_items bigint := 0;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  -- Variant-level inventory metrics
  SELECT
    coalesce(sum(available), 0),
    coalesce(sum(reserved), 0),
    count(*) FILTER (WHERE available > v_threshold),
    count(*) FILTER (WHERE available > 0 AND available <= v_threshold),
    count(*) FILTER (WHERE available = 0),
    count(*)
  INTO
    v_available_units,
    v_reserved_units,
    v_in_stock_variants,
    v_low_stock_variants,
    v_out_of_stock_variants,
    v_total_variants
  FROM public.inventory
  WHERE coalesce(deleted, false) = false;

  -- Distinct active catalog items
  SELECT count(*)
  INTO v_total_catalog_items
  FROM public.products
  WHERE coalesce(deleted, false) = false;

  RETURN jsonb_build_object(
    'threshold', v_threshold,
    'available_units', v_available_units,
    'reserved_units', v_reserved_units,
    'in_stock_variants', v_in_stock_variants,
    'low_stock_variants', v_low_stock_variants,
    'out_of_stock_variants', v_out_of_stock_variants,
    'total_variants', v_total_variants,
    'total_catalog_items', v_total_catalog_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_health_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_health_analytics() TO authenticated;

-- 8. public.get_product_performance_analytics
CREATE OR REPLACE FUNCTION public.get_product_performance_analytics(
  p_start_date date,
  p_end_date_exclusive date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_top_performing jsonb;
  v_most_wishlisted jsonb;
  v_category_distribution jsonb;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported analytics timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  v_start_utc := p_start_date::timestamp AT TIME ZONE p_timezone;
  v_end_utc := p_end_date_exclusive::timestamp AT TIME ZONE p_timezone;

  -- Top performing products in period (by completed booking value)
  WITH booking_stats AS (
    SELECT
      product_id,
      count(*) as completed_count,
      sum(rental_price) as completed_value
    FROM public.reservations
    WHERE coalesce(deleted, false) = false
      AND status = 'Completed'
      AND coalesce(completed_at, created_at) >= v_start_utc
      AND coalesce(completed_at, created_at) < v_end_utc
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  inventory_stats AS (
    SELECT
      product_doc_id as product_id,
      sum(available) as total_available
    FROM public.inventory
    WHERE coalesce(deleted, false) = false
    GROUP BY product_doc_id
  ),
  review_stats AS (
    SELECT
      product_id,
      round(avg(rating)::numeric, 1) as avg_rating,
      count(*) as review_count
    FROM public.reviews
    GROUP BY product_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_name', p.name,
    'category', p.category,
    'image_url', p.image_url,
    'completed_reservations', coalesce(bs.completed_count, 0),
    'completed_booking_value', coalesce(bs.completed_value, 0),
    'available_units', coalesce(inv.total_available, 0),
    'avg_rating', rev.avg_rating,
    'review_count', coalesce(rev.review_count, 0)
  ) ORDER BY coalesce(bs.completed_value, 0) DESC, coalesce(bs.completed_count, 0) DESC), '[]'::jsonb)
  INTO v_top_performing
  FROM booking_stats bs
  JOIN public.products p ON p.id = bs.product_id
  LEFT JOIN inventory_stats inv ON inv.product_id = p.id
  LEFT JOIN review_stats rev ON rev.product_id = p.id
  LIMIT 10;

  -- Most wishlisted products (all-time wishlist count with period completed conversion)
  -- Most wishlisted products (all-time wishlist demand)
  WITH wishlist_counts AS (
    SELECT
      product_id,
      count(*) as wishlist_count
    FROM public.wishlists
    GROUP BY product_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_name', p.name,
    'category', p.category,
    'image_url', p.image_url,
    'wishlist_count', wc.wishlist_count
  ) ORDER BY wc.wishlist_count DESC), '[]'::jsonb)
  INTO v_most_wishlisted
  FROM wishlist_counts wc
  JOIN public.products p ON p.id = wc.product_id
  WHERE coalesce(p.deleted, false) = false
  LIMIT 10;

  -- Category booking value distribution in period
  WITH cat_stats AS (
    SELECT
      coalesce(p.category, 'Uncategorized') as cat_name,
      sum(r.rental_price) as cat_val,
      count(*) as cat_cnt
    FROM public.reservations r
    JOIN public.products p ON p.id = r.product_id
    WHERE coalesce(r.deleted, false) = false
      AND r.status = 'Completed'
      AND coalesce(r.completed_at, r.created_at) >= v_start_utc
      AND coalesce(r.completed_at, r.created_at) < v_end_utc
    GROUP BY p.category
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category', cat_name,
    'value', cat_val,
    'count', cat_cnt
  ) ORDER BY cat_val DESC), '[]'::jsonb)
  INTO v_category_distribution
  FROM cat_stats;

  RETURN jsonb_build_object(
    'top_performing_items', v_top_performing,
    'most_wishlisted_items', v_most_wishlisted,
    'category_distribution', v_category_distribution
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_performance_analytics(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_performance_analytics(date, date, text) TO authenticated;

-- 9. public.get_customer_cohort_analytics
CREATE OR REPLACE FUNCTION public.get_customer_cohort_analytics(
  p_start_date date,
  p_end_date_exclusive date,
  p_timezone text DEFAULT 'Asia/Manila'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_new_registered_users integer := 0;
  v_unique_customers_served integer := 0;
  v_returning_customers integer := 0;
  v_returning_rate numeric(5,2) := NULL;
BEGIN
  PERFORM public.assert_analytics_access(v_uid);

  IF p_timezone IS DISTINCT FROM 'Asia/Manila' THEN
    RAISE EXCEPTION 'Unsupported analytics timezone: %', p_timezone USING ERRCODE = '22023';
  END IF;

  v_start_utc := p_start_date::timestamp AT TIME ZONE p_timezone;
  v_end_utc := p_end_date_exclusive::timestamp AT TIME ZONE p_timezone;

  -- New Registered Users within period
  SELECT count(*)
  INTO v_new_registered_users
  FROM public.profiles
  WHERE coalesce(deleted, false) = false
    AND role = 'customer'
    AND created_at >= v_start_utc
    AND created_at < v_end_utc;

  -- Unique Customers Served in period (customers with >= 1 Completed reservation in period)
  SELECT count(DISTINCT customer_id)
  INTO v_unique_customers_served
  FROM public.reservations
  WHERE coalesce(deleted, false) = false
    AND status = 'Completed'
    AND coalesce(completed_at, created_at) >= v_start_utc
    AND coalesce(completed_at, created_at) < v_end_utc;

  -- Returning Customers: customer with >= 1 Completed reservation in period AND >= 1 Completed reservation strictly BEFORE v_start_utc
  SELECT count(DISTINCT r_curr.customer_id)
  INTO v_returning_customers
  FROM public.reservations r_curr
  WHERE coalesce(r_curr.deleted, false) = false
    AND r_curr.status = 'Completed'
    AND coalesce(r_curr.completed_at, r_curr.created_at) >= v_start_utc
    AND coalesce(r_curr.completed_at, r_curr.created_at) < v_end_utc
    AND EXISTS (
      SELECT 1
      FROM public.reservations r_prior
      WHERE r_prior.customer_id = r_curr.customer_id
        AND coalesce(r_prior.deleted, false) = false
        AND r_prior.status = 'Completed'
        AND coalesce(r_prior.completed_at, r_prior.created_at) < v_start_utc
    );

  -- Returning rate: returning_customers / unique_customers_served (or NULL if unique_customers_served is 0)
  IF v_unique_customers_served > 0 THEN
    v_returning_rate := round((v_returning_customers::numeric / v_unique_customers_served::numeric) * 100.0, 2);
  ELSE
    v_returning_rate := NULL;
  END IF;

  RETURN jsonb_build_object(
    'new_registered_users', v_new_registered_users,
    'unique_customers_served', v_unique_customers_served,
    'returning_customers', v_returning_customers,
    'returning_customer_rate', v_returning_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_cohort_analytics(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_cohort_analytics(date, date, text) TO authenticated;
