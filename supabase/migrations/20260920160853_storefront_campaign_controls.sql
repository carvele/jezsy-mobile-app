ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS storefront_position text NOT NULL DEFAULT 'top',
  ADD COLUMN IF NOT EXISTS storefront_sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_image_storage_path text,
  ADD COLUMN IF NOT EXISTS storefront_status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS storefront_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS storefront_impressions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_taps integer NOT NULL DEFAULT 0;

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_storefront_position_check,
  ADD CONSTRAINT announcements_storefront_position_check
    CHECK (storefront_position IN ('top', 'after_featured', 'after_categories'));

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_storefront_status_check,
  ADD CONSTRAINT announcements_storefront_status_check
    CHECK (storefront_status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_announcements_storefront_position_order
  ON public.announcements (storefront_position, storefront_sort_order, created_at DESC)
  WHERE placement IN ('storefront', 'both');

INSERT INTO storage.buckets (id, name, public)
  VALUES ('storefront-images', 'storefront-images', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin or owner can manage storefront images" ON storage.objects;
CREATE POLICY "Admin or owner can manage storefront images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'storefront-images' AND public.is_admin_or_owner())
  WITH CHECK (bucket_id = 'storefront-images' AND public.is_admin_or_owner());

CREATE OR REPLACE FUNCTION public.record_storefront_campaign_event(
  p_announcement_id uuid,
  p_event text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_event NOT IN ('impression', 'tap') THEN
    RETURN;
  END IF;

  UPDATE public.announcements
  SET
    storefront_impressions = storefront_impressions + CASE WHEN p_event = 'impression' THEN 1 ELSE 0 END,
    storefront_taps = storefront_taps + CASE WHEN p_event = 'tap' THEN 1 ELSE 0 END
  WHERE id = p_announcement_id
    AND placement IN ('storefront', 'both')
    AND storefront_status = 'published'
    AND (storefront_starts_at IS NULL OR storefront_starts_at <= now())
    AND (expires_at IS NULL OR expires_at > now());
END;
$$;

REVOKE ALL ON FUNCTION public.record_storefront_campaign_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_storefront_campaign_event(uuid, text) TO authenticated;
