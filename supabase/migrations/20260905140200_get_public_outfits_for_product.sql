-- "Styled By" groundwork: which outfits feature a given product. Deliberately
-- SECURITY INVOKER (not DEFINER) -- it does no elevated-privilege work of its
-- own, so it just runs as the caller and inherits whatever saved_outfits/
-- outfit_items RLS already allows them to see. That means the private/
-- blocked/connections-only filtering in 20260905140000 and 20260905140100
-- is the actual authorization boundary here, not this function -- a caller
-- can't get more through this RPC than a direct SELECT would already permit.
CREATE OR REPLACE FUNCTION public.get_public_outfits_for_product(p_product_id uuid)
RETURNS TABLE (
  outfit_id uuid,
  outfit_name text,
  user_id uuid,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
    so.id AS outfit_id,
    so.name AS outfit_name,
    so.user_id,
    so.created_at
  FROM public.saved_outfits so
  JOIN public.outfit_items oi ON oi.outfit_id = so.id
  WHERE oi.product_id = p_product_id
    AND COALESCE(so.deleted, false) = false
  ORDER BY so.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_public_outfits_for_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_outfits_for_product(uuid) TO authenticated, anon;
