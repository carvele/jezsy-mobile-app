-- Extend pose_guides table with style gallery fields
ALTER TABLE public.pose_guides
  ADD COLUMN IF NOT EXISTS image_url      text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS occasion       text,
  ADD COLUMN IF NOT EXISTS style_tags     text[],
  ADD COLUMN IF NOT EXISTS difficulty     text DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS is_featured    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_pose_type text DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS sort_order     integer DEFAULT 0;

-- Junction table: link poses to catalog products
CREATE TABLE IF NOT EXISTS public.pose_guide_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pose_guide_id   text NOT NULL REFERENCES public.pose_guides(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(pose_guide_id, product_id)
);

-- Enable RLS
ALTER TABLE public.pose_guide_products ENABLE ROW LEVEL SECURITY;

-- Public read for mobile
CREATE POLICY "Anyone can read pose_guide_products"
  ON public.pose_guide_products FOR SELECT USING (true);

-- Staff/admin write
CREATE POLICY "Staff can manage pose_guide_products"
  ON public.pose_guide_products FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'staff'))
  );

-- Add to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pose_guide_products;

-- Create storage bucket for pose images
INSERT INTO storage.buckets (id, name, public) VALUES ('pose-images', 'pose-images', true)
  ON CONFLICT (id) DO NOTHING;
