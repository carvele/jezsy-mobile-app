-- increment_wear_count: the trusted write path for logging a wardrobe item as
-- worn today. The app previously wrote current_streak/longest_streak directly
-- onto wardrobe_items (columns that never existed there -- they live on
-- user_streaks) and called a same-named RPC that was never created. Both call
-- sites (item detail, outfit detail) errored on every attempt.
--
-- SECURITY DEFINER because it needs to write user_streaks (owned by the
-- streak, not by wardrobe_items' RLS) as a side effect of one caller action;
-- the WHERE user_id = auth.uid() guard is what keeps this from being an
-- arbitrary-item bump on someone else's wardrobe.
CREATE OR REPLACE FUNCTION increment_wear_count(p_item_id UUID)
RETURNS wardrobe_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row wardrobe_items;
BEGIN
  UPDATE wardrobe_items
  SET wear_count = wear_count + 1,
      last_worn_at = now()
  WHERE id = p_item_id
    AND user_id = auth.uid()
    AND deleted = false
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wardrobe item % not found or not owned by caller', p_item_id;
  END IF;

  PERFORM update_user_streak();

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION increment_wear_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_wear_count(UUID) TO authenticated;
