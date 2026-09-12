-- increment_wear_count called update_user_streak(auth.uid()), a 1-arg
-- signature that has never existed -- update_user_streak() takes zero
-- arguments and resolves auth.uid() internally. Every call to
-- increment_wear_count (item detail "Log Wear" and outfit detail "Log
-- Outfit Wear", which calls it once per piece) has been failing with a
-- 42883 undefined_function error since it shipped.
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
