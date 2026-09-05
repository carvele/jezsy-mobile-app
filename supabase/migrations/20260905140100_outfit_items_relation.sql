-- Moves outfit pieces out of saved_outfits.items (jsonb) into a relational
-- table so "Styled By" (which product appears in which public outfits) can
-- be queried directly instead of scanning inside JSON arrays. saved_outfits
-- keeps its items column and keeps being written to unchanged -- existing
-- wardrobe/outfit read paths are untouched by this migration; outfit_items
-- is purely additive.

CREATE TABLE IF NOT EXISTS public.outfit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id uuid NOT NULL REFERENCES public.saved_outfits(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  slot text,
  image_url text,
  name text,
  color_tags text[],
  owned boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outfit_items_outfit_id_idx ON public.outfit_items(outfit_id);
CREATE INDEX IF NOT EXISTS outfit_items_product_id_idx ON public.outfit_items(product_id);

ALTER TABLE public.outfit_items ENABLE ROW LEVEL SECURITY;

-- Backfill from the existing items jsonb array. Re-runnable: clears rows it
-- previously inserted for a given outfit before re-inserting, so replaying
-- this migration (or a future re-sync) can't duplicate items.
DELETE FROM public.outfit_items
WHERE outfit_id IN (SELECT id FROM public.saved_outfits WHERE items IS NOT NULL);

-- Some saved outfits reference a product_id whose row has since been
-- hard-deleted (or never existed) -- the FK would otherwise reject the
-- whole backfill for one bad row.
INSERT INTO public.outfit_items (outfit_id, product_id, slot, image_url, name, color_tags, owned)
SELECT
  so.id,
  (SELECT p.id FROM public.products p WHERE p.id = NULLIF(item->>'product_id', '')::uuid),
  item->>'slot',
  item->>'image_url',
  item->>'name',
  CASE
    WHEN jsonb_typeof(item->'color_tags') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(item->'color_tags'))
    ELSE NULL
  END,
  COALESCE((item->>'owned')::boolean, true)
FROM public.saved_outfits so,
     jsonb_array_elements(so.items) AS item
WHERE so.items IS NOT NULL AND jsonb_typeof(so.items) = 'array';

-- Visibility mirrors saved_outfits exactly: this EXISTS subquery runs
-- against saved_outfits under saved_outfits' own RLS policies, so a viewer
-- only sees an outfit's items if they could already see the outfit itself
-- (owner, admin, or public/connections per outfit_privacy).
DROP POLICY IF EXISTS "Outfit items inherit their outfit's visibility" ON public.outfit_items;
CREATE POLICY "Outfit items inherit their outfit's visibility" ON public.outfit_items FOR SELECT TO public
USING (
  EXISTS (SELECT 1 FROM public.saved_outfits so WHERE so.id = outfit_items.outfit_id)
);

DROP POLICY IF EXISTS "Owner manages their own outfit items" ON public.outfit_items;
CREATE POLICY "Owner manages their own outfit items" ON public.outfit_items FOR ALL TO public
USING (
  EXISTS (
    SELECT 1 FROM public.saved_outfits so
    WHERE so.id = outfit_items.outfit_id AND so.user_id = (select auth.uid())
  )
  OR public.is_staff_or_admin()
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.saved_outfits so
    WHERE so.id = outfit_items.outfit_id AND so.user_id = (select auth.uid())
  )
  OR public.is_staff_or_admin()
);
