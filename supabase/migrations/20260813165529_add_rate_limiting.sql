-- Rate limiting for the two edge functions where an unbounded burst has a
-- real cost: payments-create calls out to PayMongo's live API per request
-- (financial/abuse surface), and process-account-deletion runs an
-- irreversible data-erasure RPC. payments-webhook is deliberately NOT
-- covered here -- it authenticates via PayMongo's own signature, which is
-- the right control for a webhook with no per-caller identity to key a
-- limit on; rate-limiting it would just be extra state for no real
-- protection PayMongo doesn't already provide by only calling it when it
-- has something to say.
--
-- Fixed-window counter, not a sliding window or token bucket: simpler,
-- atomic via a single INSERT ... ON CONFLICT (no read-then-write race), and
-- good enough for "stop a runaway loop or a scripted burst" rather than
-- precise traffic shaping. The known tradeoff is a caller can send up to
-- 2x the limit across a window boundary (p_max_requests at the end of one
-- window, p_max_requests again at the start of the next) -- acceptable for
-- what this guards against.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No client-facing policies at all: only check_rate_limit (SECURITY
-- DEFINER, owned by postgres, bypasses RLS) touches this table. Nothing
-- with a policy grant needs to read or write it directly.

-- Only edge functions (via the service-role client) call this -- never
-- exposed to anon/authenticated. REVOKE FROM PUBLIC explicitly: the default
-- PUBLIC grant on a new function means REVOKE FROM anon alone would no-op
-- (see this repo's has_function_privilege convention for verifying this).
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limits (key, window_start, request_count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Opportunistic cleanup instead of a dedicated cron: ~1% of calls sweep
  -- windows over an hour old. Keeps the table bounded without adding a new
  -- scheduled job for what is, worst case, a slow-growing housekeeping cost.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
  END IF;

  RETURN v_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
