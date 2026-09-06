-- 1. Restore legacy column
ALTER TABLE public.conversations
ADD COLUMN unread_count integer NOT NULL DEFAULT 0;

-- 2. Migrate data back (take the greatest of the two)
UPDATE public.conversations
SET unread_count = GREATEST(unread_customer, unread_staff);

-- 3. Drop new columns
ALTER TABLE public.conversations
DROP COLUMN unread_customer,
DROP COLUMN unread_staff;
