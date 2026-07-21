-- Migration: One review per user per product
--
-- reviews had a rating CHECK and a rating-sync trigger to products, but no
-- constraint stopping one user from reviewing the same product repeatedly
-- and skewing the aggregate. 0 rows -- no backfill.

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_product_user_key UNIQUE (product_id, user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews (user_id);
