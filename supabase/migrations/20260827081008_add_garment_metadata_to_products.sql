-- Adds the canonical GarmentMetadata blob to products.
-- Kept as JSONB (not columns) for the same reason as ar_data:
-- the shape is still evolving and is read/written from one place only.
-- ar_data retains its existing shape (owner status + alignment blobs).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS garment_metadata jsonb;
