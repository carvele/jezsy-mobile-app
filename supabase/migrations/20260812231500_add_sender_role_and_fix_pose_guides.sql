-- Add sender_role column to messages table if not present
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_role text DEFAULT 'customer';

-- Ensure all extended columns exist on pose_guides table
ALTER TABLE public.pose_guides
  ADD COLUMN IF NOT EXISTS image_url      text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS occasion       text,
  ADD COLUMN IF NOT EXISTS style_tags     text[],
  ADD COLUMN IF NOT EXISTS difficulty     text DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS is_featured    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_pose_type text DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS sort_order     integer DEFAULT 0;
