-- Expand products table schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS fabric text,
ADD COLUMN IF NOT EXISTS tags text[],
ADD COLUMN IF NOT EXISTS restock_date timestamptz;

-- We already have 'stock' as an integer column, so we won't add 'stock_count', 
-- but we will add a GIN index on tags for the requested multi-attribute search.
CREATE INDEX IF NOT EXISTS products_tags_idx ON public.products USING GIN (tags);


