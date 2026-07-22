DROP INDEX IF EXISTS public.idx_reviews_user_id;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_product_user_key;
