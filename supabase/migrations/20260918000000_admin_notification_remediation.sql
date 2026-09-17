-- 1. Create the receipts table
CREATE TABLE IF NOT EXISTS public.admin_notification_receipts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT false,
    is_dismissed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(notification_id, user_id)
);

-- 2. Add structured fields to admin_notifications (making it server-controlled)
ALTER TABLE public.admin_notifications
ADD COLUMN IF NOT EXISTS event_key TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS entity_type TEXT,
ADD COLUMN IF NOT EXISTS entity_id TEXT,
ADD COLUMN IF NOT EXISTS data JSONB,
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';

-- 3. Lock down write authority on admin_notifications
REVOKE ALL ON public.admin_notifications FROM anon, authenticated;
GRANT SELECT ON public.admin_notifications TO authenticated;

DROP POLICY IF EXISTS "Admins can manage admin notifications" ON public.admin_notifications;

CREATE POLICY "Admins can view admin notifications" ON public.admin_notifications
FOR SELECT
TO authenticated
USING (public.is_staff_or_admin());

-- 4. Set up RLS for receipts
ALTER TABLE public.admin_notification_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own receipts" ON public.admin_notification_receipts
FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 5. Backfill receipts for existing notifications
INSERT INTO public.admin_notification_receipts (notification_id, user_id, is_read, created_at)
SELECT n.id, p.id, n.is_read, n.created_at
FROM public.admin_notifications n
CROSS JOIN (
    SELECT id FROM public.profiles WHERE role IN ('staff', 'admin', 'owner') AND deleted = false
) p
ON CONFLICT (notification_id, user_id) DO NOTHING;

-- 6. Trigger to fan out receipts on new notifications
CREATE OR REPLACE FUNCTION public.trg_fanout_admin_notification()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.admin_notification_receipts (notification_id, user_id)
    SELECT NEW.id, id
    FROM public.profiles
    WHERE role IN ('staff', 'admin', 'owner')
      AND deleted = false;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fanout_admin_notification_insert ON public.admin_notifications;
CREATE TRIGGER trg_fanout_admin_notification_insert
AFTER INSERT ON public.admin_notifications
FOR EACH ROW
EXECUTE FUNCTION public.trg_fanout_admin_notification();

-- 7. Create the unified view for the client
CREATE OR REPLACE VIEW public.admin_user_notifications_view AS
SELECT 
    r.id, -- receipt id used by UI for updates
    r.notification_id,
    r.user_id,
    n.title,
    n.message,
    n.type,
    n.event_key,
    n.actor_id,
    n.entity_type,
    n.entity_id,
    n.data,
    n.priority,
    r.is_read,
    r.is_dismissed,
    n.created_at
FROM public.admin_notifications n
JOIN public.admin_notification_receipts r ON n.id = r.notification_id
WHERE r.is_dismissed = false;

GRANT SELECT ON public.admin_user_notifications_view TO authenticated;

-- 8. Narrowly scoped RPCs for marking as read and dismissing
CREATE OR REPLACE FUNCTION public.mark_admin_notifications_read(p_receipt_ids UUID[])
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
    UPDATE public.admin_notification_receipts
    SET is_read = true
    WHERE id = ANY(p_receipt_ids)
      AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.dismiss_admin_notifications(p_receipt_ids UUID[])
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
    UPDATE public.admin_notification_receipts
    SET is_dismissed = true
    WHERE id = ANY(p_receipt_ids)
      AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_admin_notifications_read(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_admin_notifications(UUID[]) TO authenticated;

-- 9. Add to realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_notification_receipts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notification_receipts;
    END IF;
END $$;
-- 10. Add recommended indexes
CREATE INDEX IF NOT EXISTS idx_admin_notification_receipts_unread 
ON public.admin_notification_receipts (user_id, is_read, is_dismissed) 
WHERE is_read = false AND is_dismissed = false;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at 
ON public.admin_notifications (created_at DESC);
-- 11. RPC for exact unread count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.admin_notification_receipts
    WHERE user_id = auth.uid() AND is_read = false AND is_dismissed = false;
$$;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count() TO authenticated;
-- 12. Update existing triggers to populate entity fields
CREATE OR REPLACE FUNCTION public.notify_admin_on_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_customer_name TEXT;
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        SELECT COALESCE(full_name, 'A customer') INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
    ELSE
        v_customer_name := 'A customer';
    END IF;
    
    INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id, event_key)
    VALUES (
        'New Reservation',
        COALESCE(v_customer_name || ' placed a new reservation for ' || COALESCE(NEW.product_name, 'an item') || '.', 'New reservation received.'),
        'Reservation',
        'reservation',
        NEW.id::text,
        'res_insert_' || NEW.id::text
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admin_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_customer_name TEXT;
BEGIN
    IF NEW.sender_role != 'staff' THEN
        SELECT COALESCE(full_name, 'A customer') INTO v_customer_name FROM public.profiles WHERE id = NEW.sender_id;
        
        INSERT INTO public.admin_notifications (title, message, type, entity_type, entity_id, event_key)
        VALUES (
            'New Message',
            v_customer_name || ' sent a new message.',
            'Message',
            'message',
            NEW.conversation_id::text,
            'msg_insert_' || NEW.id::text
        );
    END IF;
    RETURN NEW;
END;
$$;
