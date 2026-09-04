DROP TRIGGER IF EXISTS trigger_set_reviewer_name ON public.reviews;
DROP FUNCTION IF EXISTS public.tr_reviews_set_reviewer_name();
DROP FUNCTION IF EXISTS public.get_trending_products(int);
