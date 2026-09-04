CREATE TABLE IF NOT EXISTS public.admin_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Only admins can view and manage admin notifications
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage admin notifications" ON public.admin_notifications
FOR ALL
TO public
USING (public.is_staff_or_admin());

-- Trigger to create notification on new reservation
CREATE OR REPLACE FUNCTION public.notify_admin_on_reservation()
RETURNS TRIGGER AS $$
DECLARE
    v_customer_name TEXT;
BEGIN
    SELECT COALESCE(full_name, 'A customer') INTO v_customer_name FROM public.profiles WHERE id = NEW.customer_id;
    
    INSERT INTO public.admin_notifications (title, message, type)
    VALUES (
        'New Reservation',
        v_customer_name || ' placed a new reservation for ' || COALESCE(NEW.product_name, 'an item') || '.',
        'Reservation'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_admin_on_reservation ON public.reservations;
CREATE TRIGGER trg_notify_admin_on_reservation
AFTER INSERT ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_on_reservation();

-- Trigger to create notification on new message
CREATE OR REPLACE FUNCTION public.notify_admin_on_message()
RETURNS TRIGGER AS $$
DECLARE
    v_customer_name TEXT;
BEGIN
    IF NEW.sender_role != 'staff' THEN
        SELECT COALESCE(full_name, 'A customer') INTO v_customer_name FROM public.profiles WHERE id = NEW.sender_id;
        
        INSERT INTO public.admin_notifications (title, message, type)
        VALUES (
            'New Message',
            v_customer_name || ' sent a new message.',
            'Message'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_admin_on_message ON public.messages;
CREATE TRIGGER trg_notify_admin_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_on_message();
