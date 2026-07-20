ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_product_user_key UNIQUE (product_id, user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews (user_id);
