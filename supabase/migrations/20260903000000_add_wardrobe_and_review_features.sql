-- Add is_wardrobe_shared to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_wardrobe_shared BOOLEAN DEFAULT false;

-- Add new features to reviews
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS dislikes INTEGER DEFAULT 0;
