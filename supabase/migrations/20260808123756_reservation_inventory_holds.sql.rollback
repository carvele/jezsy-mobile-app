-- Removes server-side stock enforcement, returning reservations to the state
-- where any quantity of anything could be reserved regardless of inventory.
--
-- NOTE: dropping the triggers stops future holds and releases, but does NOT
-- unwind holds already taken. Any reservation live at rollback time will have
-- left inventory.reserved incremented and inventory.available decremented,
-- and nothing will ever give those back. Reconcile manually afterwards:
--
--   WITH held AS (
--     SELECT ri.product_id, ri.size, sum(ri.quantity) AS qty
--     FROM public.reservation_items ri
--     JOIN public.reservations r ON r.id = ri.reservation_id
--     WHERE public.reservation_holds_stock(r.status, r.deleted)
--     GROUP BY ri.product_id, ri.size
--   )
--   SELECT * FROM held;   -- then hand back to available / zero out reserved
--
-- (Run that BEFORE dropping reservation_holds_stock below, since it uses it.)

DROP TRIGGER IF EXISTS trg_hold_inventory_on_reservation_item ON public.reservation_items;
DROP TRIGGER IF EXISTS trg_release_inventory_on_reservation_item_delete ON public.reservation_items;
DROP TRIGGER IF EXISTS trg_apply_inventory_on_reservation_status ON public.reservations;

DROP FUNCTION IF EXISTS public.hold_inventory_for_reservation_item();
DROP FUNCTION IF EXISTS public.apply_inventory_on_reservation_status_change();
DROP FUNCTION IF EXISTS public.release_inventory_for_reservation_item();
DROP FUNCTION IF EXISTS public.reservation_holds_stock(text, boolean);
