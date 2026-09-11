-- Complete the Look (Phase 1): the atomic "promote a suggestion" RPC.
--
-- The frozen plan's idempotency guarantee -- promoting an already-active
-- link is a literal no-op, not a fresh updated_by/updated_at event -- needs
-- `ON CONFLICT (...) DO UPDATE ... WHERE is_active = false` in one
-- statement, so a concurrent promote can't race a plain SELECT-then-UPDATE
-- from the client into double-counting. PostgREST's upsert endpoint has no
-- way to express a conditional WHERE on the conflict action, so this has to
-- be a database function.
--
-- SECURITY INVOKER, not DEFINER: the real authorization is already the
-- table's own RLS ("Manage complements insert/update", both gated on
-- can_manage_inventory()) -- this function only packages a SQL construct the
-- REST API can't express, it doesn't need or want elevated privilege of its
-- own. That also means it must RETURN only the columns the invoking role
-- actually has SELECT privilege on (id/product_id/complementary_product_id/
-- sort_order) -- a bare RETURNING * would hit the same column-level REVOKE
-- that hides audit metadata from clients and fail with a permission error.
-- Phase 1 doesn't need audit visibility from the admin UI anyway (see the
-- product_complements migration's own header note).

-- RETURNS TABLE columns are prefixed out_ because plpgsql turns them into
-- OUT variables in scope for the whole function body -- an unprefixed
-- product_id collides with the ON CONFLICT (product_id, ...) target list,
-- which Postgres resolves against variables before columns ("column
-- reference product_id is ambiguous"), confirmed live before shipping.
CREATE OR REPLACE FUNCTION public.promote_product_complement_suggestion(
  p_product_id uuid,
  p_complementary_product_id uuid,
  p_origin text,
  p_sort_order integer DEFAULT 0
)
RETURNS TABLE (out_id uuid, out_product_id uuid, out_complementary_product_id uuid, out_sort_order integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO public.product_complements AS pc (product_id, complementary_product_id, sort_order, origin, is_active)
  VALUES (p_product_id, p_complementary_product_id, p_sort_order, p_origin, true)
  ON CONFLICT (product_id, complementary_product_id)
  DO UPDATE SET
    is_active = true,
    sort_order = EXCLUDED.sort_order,
    origin = EXCLUDED.origin
  WHERE pc.is_active = false
  RETURNING pc.id, pc.product_id, pc.complementary_product_id, pc.sort_order;

  -- The WHERE clause above skips rows that were already active -- no INSERT
  -- happened (conflict) and no UPDATE happened (guard failed), so RETURNING
  -- produced zero rows even though the pair genuinely exists. Re-select the
  -- current row so the caller always gets a consistent result whether this
  -- was a fresh insert, a reactivation, or a real no-op.
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT pc.id, pc.product_id, pc.complementary_product_id, pc.sort_order
    FROM public.product_complements pc
    WHERE pc.product_id = p_product_id AND pc.complementary_product_id = p_complementary_product_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_product_complement_suggestion(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_product_complement_suggestion(uuid, uuid, text, integer) TO authenticated;
