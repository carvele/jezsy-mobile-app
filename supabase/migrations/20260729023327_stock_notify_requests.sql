-- Feature: "Notify me" for an out-of-stock size. Per-size stock is already
-- tracked in public.inventory; this adds a watch-list table and a trigger
-- that fires when a watched (product, size) goes from 0 to available.
--
-- One-shot: the trigger deletes matching requests after notifying, same as
-- most "notify me" flows -- a user who wants another alert after the item
-- sells out again just re-requests. Mirrors the SECURITY DEFINER trigger
-- pattern already used for reservation/order status notifications
-- (20260722012625_notification_triggers.sql).

CREATE TABLE IF NOT EXISTS public.stock_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    size text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (user_id, product_id, size)
);

ALTER TABLE public.stock_notify_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own stock notify requests" ON public.stock_notify_requests;
CREATE POLICY "Users manage own stock notify requests"
  ON public.stock_notify_requests FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_stock_back_in_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_name text;
BEGIN
  IF NEW.deleted OR NEW.product_doc_id IS NULL OR NEW.size IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (coalesce(OLD.available, 0) <= 0 AND coalesce(NEW.available, 0) > 0) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_doc_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    r.user_id,
    'system',
    'Back in Stock',
    coalesce(v_product_name, 'An item') || ' (size ' || NEW.size || ') is back in stock.',
    jsonb_build_object('product_id', NEW.product_doc_id, 'size', NEW.size)
  FROM public.stock_notify_requests r
  WHERE r.product_id = NEW.product_doc_id AND r.size = NEW.size;

  DELETE FROM public.stock_notify_requests
  WHERE product_id = NEW.product_doc_id AND size = NEW.size;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_stock_back_in_stock ON public.inventory;
CREATE TRIGGER trg_notify_stock_back_in_stock
AFTER UPDATE ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.notify_stock_back_in_stock();

-- Same treatment as the other notify_*/trg_* functions in
-- 20260728015951_revoke_direct_rpc_on_trigger_functions.sql: not meant to
-- be reachable via /rest/v1/rpc/, and REVOKE FROM anon alone is a no-op
-- since EXECUTE is granted to PUBLIC by default.
REVOKE EXECUTE ON FUNCTION public.notify_stock_back_in_stock() FROM PUBLIC, anon, authenticated;
