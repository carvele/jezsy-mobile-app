-- Feature: admin-broadcast announcements for the Inbox Notifications tab.
--
-- public.notifications requires a user_id per row and is only ever written
-- by two SECURITY DEFINER triggers scoped to one customer's reservation/
-- order status change (20260722012625_notification_triggers.sql). There is
-- no path for a staff-authored message to reach every inbox, and nothing
-- reaches a user who signs up after the message was created.
--
-- Shape: one row per announcement, not one row per recipient. A brand-new
-- account has zero dismissal rows, so every still-active announcement shows
-- up for it with no fan-out-on-signup trigger and no expiry cleanup job --
-- the read-time filter (not expired, not dismissed) does both for free.

CREATE TABLE IF NOT EXISTS public.announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text NOT NULL,
    type text NOT NULL DEFAULT 'promo' CHECK (type = ANY (ARRAY['promo'::text, 'system'::text])),
    created_by uuid REFERENCES public.profiles(id),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    dismissed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, announcement_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at
    ON public.announcements (expires_at);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view announcements" ON public.announcements;
CREATE POLICY "Authenticated users can view announcements"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff manage announcements" ON public.announcements;
CREATE POLICY "Staff manage announcements"
  ON public.announcements FOR ALL
  TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

DROP POLICY IF EXISTS "Users manage own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users manage own dismissals"
  ON public.announcement_dismissals FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
