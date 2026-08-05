-- Drops the child table entirely. Safe only while the legacy parent product
-- columns are still populated (they are -- the forward migration is
-- expand-only and never stopped writing them), so reverting loses no
-- reservation data for single-line reservations. Any reservation that had
-- more than one line WILL lose its extra lines, since the parent can only
-- represent one product.

DROP TABLE IF EXISTS public.reservation_items;
