-- Server-side stock enforcement for reservations.
--
-- THE DEFECT: create_reservation_multi (and legacy create_reservation)
-- validate `quantity < 1` and a 20-line cap, and nothing else. Neither
-- references public.inventory or products.stock at all, so a client could
-- reserve any quantity of anything. The client-side cap added in
-- src/context/CartContext.tsx is not enforcement -- it is bypassable by
-- calling the RPC directly, and it reads products.stock, which is a derived
-- SUM across every size (see sync_product_stock) rather than the per-size
-- figure that actually constrains a reservation. Verified example at the time
-- of writing: "Seamless Sports Bra" had products.stock = 30 while size XS had
-- inventory.available = 6, so 30x XS was reservable.
--
-- WHY TRIGGERS AND NOT A CHECK INSIDE THE RPC: stock has to be released as
-- well as taken, on every path that ends a reservation -- customer cancel,
-- staff decline (admin-dashboard repo), expire_unpaid_reservations() (sets
-- 'Cancelled'), verify_pickup() (sets 'Completed'). Patching each call site
-- is how holds leak permanently, which is worse than not tracking at all.
-- Both creation paths write public.reservation_items, and every termination
-- path is a status/deleted UPDATE on public.reservations, so two triggers
-- cover all of them -- including future paths nobody has written yet.
--
-- INVENTORY MODEL (verified against live data, not assumed):
--   public.inventory is the source of truth, keyed (product_doc_id, size).
--   available = free to reserve, reserved = held by live reservations,
--   total = physical units in the boutique.
--   products.stock is derived: trg_sync_product_stock_from_inventory calls
--   sync_product_stock(), which sums inventory.available into it. It stays
--   accurate automatically as holds/releases move `available`.
--
-- BASELINE AT APPLY TIME (verified): all 5 reservations were 'Cancelled',
-- sum(inventory.reserved) = 0. So zero live holds existed and reserved = 0
-- was already correct -- no backfill is performed or needed. If this is ever
-- re-applied to a database where live (non-Cancelled, non-Completed)
-- reservations exist with reserved = 0, inventory needs a manual
-- reconciliation first; this migration deliberately does not bulk-rewrite
-- available/reserved, because staff maintain those numbers directly in the
-- admin dashboard and a blind UPDATE here would stomp real counts.
--   Re-check with:
--     SELECT count(*) FROM public.reservations
--     WHERE public.reservation_holds_stock(status, deleted);

-- Single definition of "is this reservation currently holding stock", so the
-- hold and release sides cannot drift apart. lower() because status is stored
-- capitalized but compared case-insensitively elsewhere in this schema (see
-- expire_unpaid_reservations).
CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NOT coalesce(_deleted, false)
     AND lower(coalesce(_status, '')) NOT IN ('completed', 'cancelled');
$$;

-- Validate + take the hold, atomically. SELECT ... FOR UPDATE is what closes
-- the two-customers-race-the-last-unit case: under READ COMMITTED the second
-- transaction blocks on the lock, then re-reads the row the first one
-- committed, so it sees the decremented figure rather than the stale one.
CREATE OR REPLACE FUNCTION public.hold_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_deleted boolean;
  v_available integer;
  v_product_name text;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
    INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = NEW.reservation_id;

  IF NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN NEW;
  END IF;

  SELECT i.available INTO v_available
  FROM public.inventory i
  WHERE i.product_doc_id = NEW.product_id
    AND i.size IS NOT DISTINCT FROM NEW.size
    AND i.deleted = false
  FOR UPDATE;

  -- No inventory row means this variant is not stock-tracked. Treated as
  -- available rather than sold out, matching the rule already stated in
  -- src/utils/stock.ts -- rejecting here would make the legacy catalogue
  -- (products predating per-size inventory) unreservable.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_available < NEW.quantity THEN
    SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
    RAISE EXCEPTION 'Only % left of % (size %).',
      v_available,
      coalesce(v_product_name, 'this item'),
      coalesce(NEW.size, 'one size')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory
  SET available = available - NEW.quantity,
      reserved  = coalesce(reserved, 0) + NEW.quantity
  WHERE product_doc_id = NEW.product_id
    AND size IS NOT DISTINCT FROM NEW.size
    AND deleted = false;

  RETURN NEW;
END;
$$;

-- Release on cancellation/soft-delete, consume on pickup, re-take on
-- reactivation. Driven off the status/deleted transition rather than off any
-- particular caller.
CREATE OR REPLACE FUNCTION public.apply_inventory_on_reservation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was boolean;
  v_now boolean;
  v_short record;
BEGIN
  v_was := public.reservation_holds_stock(OLD.status, OLD.deleted);
  v_now := public.reservation_holds_stock(NEW.status, NEW.deleted);

  -- UPDATE OF fires whenever the column is in the SET list, value changed or
  -- not, so no-op transitions are filtered here.
  IF v_was = v_now THEN
    RETURN NEW;
  END IF;

  IF v_was AND NOT v_now THEN
    IF lower(coalesce(NEW.status, '')) = 'completed' AND NOT coalesce(NEW.deleted, false) THEN
      -- Picked up: the unit physically leaves the boutique. Drop the hold and
      -- the physical count; `available` was already decremented at hold time
      -- and must stay down.
      UPDATE public.inventory i
      SET reserved = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          total    = GREATEST(coalesce(i.total, 0) - ri.quantity, 0)
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.deleted = false;
    ELSE
      -- Cancelled or soft-deleted: the hold returns to available. This can
      -- take a size from 0 back to positive, which correctly fires the
      -- existing trg_notify_stock_back_in_stock waitlist notification.
      UPDATE public.inventory i
      SET reserved  = GREATEST(coalesce(i.reserved, 0) - ri.quantity, 0),
          available = coalesce(i.available, 0) + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = NEW.id
        AND i.product_doc_id = ri.product_id
        AND i.size IS NOT DISTINCT FROM ri.size
        AND i.deleted = false;
    END IF;
  ELSE
    -- Not holding -> holding. Reverting a completed pickup is refused rather
    -- than guessed at: `total` was already reduced when the goods left, so
    -- silently re-holding would leave the physical count wrong with no
    -- indication. Staff adjust inventory directly for that case.
    IF lower(coalesce(OLD.status, '')) = 'completed' THEN
      RAISE EXCEPTION 'A completed pickup cannot be reopened; adjust inventory manually instead.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT ri.size AS size, i.available AS available
      INTO v_short
    FROM public.reservation_items ri
    JOIN public.inventory i
      ON i.product_doc_id = ri.product_id
     AND i.size IS NOT DISTINCT FROM ri.size
     AND i.deleted = false
    WHERE ri.reservation_id = NEW.id
      AND i.available < ri.quantity
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Cannot reactivate this reservation: only % left of size %.',
        v_short.available, coalesce(v_short.size, 'one size')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.inventory i
    SET available = coalesce(i.available, 0) - ri.quantity,
        reserved  = coalesce(i.reserved, 0) + ri.quantity
    FROM public.reservation_items ri
    WHERE ri.reservation_id = NEW.id
      AND i.product_doc_id = ri.product_id
      AND i.size IS NOT DISTINCT FROM ri.size
      AND i.deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

-- Defensive: nothing in either app deletes reservation_items today, but a
-- line removed from a still-live reservation must not leave its hold behind.
CREATE OR REPLACE FUNCTION public.release_inventory_for_reservation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_deleted boolean;
BEGIN
  SELECT r.status, coalesce(r.deleted, false)
    INTO v_status, v_deleted
  FROM public.reservations r
  WHERE r.id = OLD.reservation_id;

  -- Parent already gone (cascade) or no longer holding: nothing to give back.
  IF NOT FOUND OR NOT public.reservation_holds_stock(v_status, v_deleted) THEN
    RETURN OLD;
  END IF;

  UPDATE public.inventory
  SET reserved  = GREATEST(coalesce(reserved, 0) - OLD.quantity, 0),
      available = coalesce(available, 0) + OLD.quantity
  WHERE product_doc_id = OLD.product_id
    AND size IS NOT DISTINCT FROM OLD.size
    AND deleted = false;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_hold_inventory_on_reservation_item ON public.reservation_items;
CREATE TRIGGER trg_hold_inventory_on_reservation_item
AFTER INSERT ON public.reservation_items
FOR EACH ROW EXECUTE FUNCTION public.hold_inventory_for_reservation_item();

DROP TRIGGER IF EXISTS trg_release_inventory_on_reservation_item_delete ON public.reservation_items;
CREATE TRIGGER trg_release_inventory_on_reservation_item_delete
AFTER DELETE ON public.reservation_items
FOR EACH ROW EXECUTE FUNCTION public.release_inventory_for_reservation_item();

DROP TRIGGER IF EXISTS trg_apply_inventory_on_reservation_status ON public.reservations;
CREATE TRIGGER trg_apply_inventory_on_reservation_status
AFTER UPDATE OF status, deleted ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_on_reservation_status_change();

-- Same treatment as the other trigger functions in
-- 20260728015951_revoke_direct_rpc_on_trigger_functions.sql: these are only
-- ever meant to run as triggers, never as callable RPCs.
REVOKE EXECUTE ON FUNCTION public.hold_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_inventory_on_reservation_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_inventory_for_reservation_item() FROM PUBLIC, anon, authenticated;
