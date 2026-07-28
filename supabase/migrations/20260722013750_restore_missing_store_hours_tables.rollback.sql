DROP POLICY IF EXISTS "Authenticated users can view store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Staff manage store hours" ON public.store_hours;
DROP POLICY IF EXISTS "Authenticated users can view store closures" ON public.store_closures;
DROP POLICY IF EXISTS "Staff manage store closures" ON public.store_closures;

DROP TABLE IF EXISTS public.store_hours;
DROP TABLE IF EXISTS public.store_closures;
