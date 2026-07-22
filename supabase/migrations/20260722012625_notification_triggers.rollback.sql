DROP TRIGGER IF EXISTS trg_notify_reservation_status_change ON public.reservations;
DROP TRIGGER IF EXISTS trg_notify_order_status_change ON public.orders;
DROP FUNCTION IF EXISTS public.notify_reservation_status_change();
DROP FUNCTION IF EXISTS public.notify_order_status_change();
