-- 1. Add new columns
ALTER TABLE public.conversations
ADD COLUMN unread_customer integer NOT NULL DEFAULT 0,
ADD COLUMN unread_staff integer NOT NULL DEFAULT 0;

-- 2. Migrate existing data (conservatively assign unread_count to both)
UPDATE public.conversations
SET 
  unread_customer = COALESCE(unread_count, 0),
  unread_staff = COALESCE(unread_count, 0);

-- 3. Drop legacy column
ALTER TABLE public.conversations
DROP COLUMN unread_count;
