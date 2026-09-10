-- POS v1 Migration-2: historical back-fill + NOT NULL enforcement for
-- purchase_mode/sales_channel. Safe to run now that the legacy
-- three-argument record_boutique_sale is dropped (20260910240000) and
-- every remaining writer of public.reservations sets both columns
-- explicitly (20260910230000, the writer-audit gate).
--
-- Historical back-fill (31 rows as of this migration):
--   purchase_mode: 100% reliable. Every existing NULL row has customer_id
--   IS NOT NULL and none match the walk-in pattern (customer_name =
--   'Walk-in Customer' AND customer_id IS NULL AND staff_id IS NOT NULL,
--   confirmed zero matches live) -- these are all genuine reservations,
--   never walk-in sales, so 'reservation' is unambiguous.
--
--   sales_channel: NOT individually verifiable. Neither create_reservation/
--   create_reservation_multi nor create_admin_reservation ever logged which
--   one created a given row before this discriminator existed, and
--   assigned_staff_id / logs entries on these rows reflect later staff
--   activity (claiming, status changes), not original creation channel.
--   Backfilled to 'mobile' as a documented best-effort default -- this is
--   the dominant channel by volume and is consistent with (not overriding)
--   the DEFAULT this same migration applies to all future rows, so no
--   historical row ends up with a value that a fresh row wouldn't also get
--   by default. Rows genuinely created via create_admin_reservation before
--   this migration are mislabeled 'mobile' rather than 'admin_assisted';
--   documented here as a known, accepted imprecision in historical data.
UPDATE public.reservations
SET purchase_mode = 'reservation',
    sales_channel = 'mobile'
WHERE purchase_mode IS NULL;

ALTER TABLE public.reservations
  ALTER COLUMN purchase_mode SET DEFAULT 'reservation',
  ALTER COLUMN sales_channel SET DEFAULT 'mobile',
  ALTER COLUMN purchase_mode SET NOT NULL,
  ALTER COLUMN sales_channel SET NOT NULL;
