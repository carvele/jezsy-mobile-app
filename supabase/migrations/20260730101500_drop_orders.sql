-- Retires the buy-and-ship path. JezSy is reserve-and-collect: the bag now
-- feeds create_reservation one item at a time, and nothing in the mobile app
-- calls create_order any more.
--
-- DESTRUCTIVE, AND NOT ONLY FOR THIS REPO. The owner-dashboard shares this
-- database and very likely has an Orders screen reading these tables. Dropping
-- them breaks that app instantly. Confirm with the owner-dashboard owner before
-- applying -- the same warning 20260727080200 carried, for the same reason.
--
-- Both tables were empty (0 rows) when this was written, so nothing is lost.
-- Re-check that before applying:
--   SELECT count(*) FROM public.orders;
--   SELECT count(*) FROM public.order_items;
--
-- Incidentally closes a real hole: create_order inserted every row with
-- status 'paid' and never took payment, so any authenticated user could mint a
-- settled order for free.

DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb);

DROP TABLE IF EXISTS public.order_items;
DROP TABLE IF EXISTS public.orders;
