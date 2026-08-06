-- A reservation could only ever hold one product: the product columns live
-- directly on the reservations row. Multi-item reservations need a child
-- table, so lines move here and the parent keeps only what is genuinely
-- per-reservation (customer, appointment, payment, receipt, status).
--
-- Expand-only on purpose. The legacy parent columns (product_id,
-- product_name, image_url, size, color, quantity, rental_price) are left in
-- place and still populated, because the shipped mobile builds and the
-- admin dashboard both read them today. Dropping them is a later contract
-- step, once every reader is on reservation_items.

CREATE TABLE IF NOT EXISTS public.reservation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  -- Snapshots, not joins: a line has to keep reading correctly after the
  -- product is renamed, repriced, or soft-deleted.
  product_name text,
  image_url text,
  size text,
  color text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reservation_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT reservation_items_unit_price_nonnegative CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS reservation_items_reservation_id_idx
  ON public.reservation_items (reservation_id);
CREATE INDEX IF NOT EXISTS reservation_items_product_id_idx
  ON public.reservation_items (product_id);

ALTER TABLE public.reservation_items ENABLE ROW LEVEL SECURITY;

-- Mirrors the parent's policies exactly: a customer reads the lines of a
-- reservation they own, staff read everything, and direct writes are
-- admin-only so the SECURITY DEFINER RPCs stay the only customer write path.
DROP POLICY IF EXISTS "Enable select for own reservation items or staff" ON public.reservation_items;
CREATE POLICY "Enable select for own reservation items or staff"
ON public.reservation_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = reservation_items.reservation_id
      AND (r.customer_id = (SELECT auth.uid()) OR public.is_staff_or_admin())
  )
);

DROP POLICY IF EXISTS "Enable insert for admin only" ON public.reservation_items;
CREATE POLICY "Enable insert for admin only"
ON public.reservation_items
FOR INSERT
WITH CHECK (public.is_admin_or_owner());

DROP POLICY IF EXISTS "Enable update for admin only" ON public.reservation_items;
CREATE POLICY "Enable update for admin only"
ON public.reservation_items
FOR UPDATE
USING (public.is_admin_or_owner())
WITH CHECK (public.is_admin_or_owner());

DROP POLICY IF EXISTS "Enable delete for admin and owner" ON public.reservation_items;
CREATE POLICY "Enable delete for admin and owner"
ON public.reservation_items
FOR DELETE
USING (public.is_admin_or_owner());

-- Backfill: every existing reservation becomes a one-line reservation, so
-- readers can treat reservation_items as the single source for lines
-- without special-casing pre-migration rows. Guarded so a re-apply cannot
-- duplicate lines.
INSERT INTO public.reservation_items (
  reservation_id, product_id, product_name, image_url,
  size, color, quantity, unit_price, created_at
)
SELECT
  r.id, r.product_id, r.product_name, r.image_url,
  r.size, r.color, COALESCE(r.quantity, 1), COALESCE(r.rental_price, 0), r.created_at
FROM public.reservations r
WHERE NOT EXISTS (
  SELECT 1 FROM public.reservation_items ri WHERE ri.reservation_id = r.id
);
