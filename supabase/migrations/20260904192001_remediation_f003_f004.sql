-- F-003: RPC for trending products to prevent full table scans
CREATE OR REPLACE FUNCTION public.get_trending_products(limit_count int DEFAULT 6)
RETURNS SETOF public.products AS $$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM public.products p
  WHERE p.visibility = 'public' AND p.deleted = false
  ORDER BY 
    (p.stock IS NULL OR p.stock > 0) DESC,
    p.review_count DESC NULLS LAST,
    p.rating DESC NULLS LAST,
    p.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- F-004: Trigger to set reviewer_name securely on insert
CREATE OR REPLACE FUNCTION public.tr_reviews_set_reviewer_name()
RETURNS TRIGGER AS $$
DECLARE
  v_first_name text;
  v_last_name text;
BEGIN
  -- Always enforce user_id matches auth.uid()
  NEW.user_id := auth.uid();
  
  -- Fetch the profile name
  SELECT first_name, last_name INTO v_first_name, v_last_name 
  FROM public.profiles 
  WHERE id = NEW.user_id;
  
  IF v_first_name IS NOT NULL THEN
    IF v_last_name IS NOT NULL AND v_last_name != '' THEN
      NEW.reviewer_name := v_first_name || ' ' || SUBSTRING(v_last_name FROM 1 FOR 1) || '.';
    ELSE
      NEW.reviewer_name := v_first_name;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_set_reviewer_name ON public.reviews;
CREATE TRIGGER trigger_set_reviewer_name
BEFORE INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.tr_reviews_set_reviewer_name();

-- search_catalog (F-001) is NOT redefined here -- it conflicted with the
-- OR-mode version in 20260904192000_remediation_f001.sql (search_query and
-- category_ids matched independently here vs. OR'd together there). The
-- client derives category_ids from the search text specifically to widen
-- matches, which only the OR-mode version honors, so f001's definition is
-- the one that stands. See that migration for search_catalog.
