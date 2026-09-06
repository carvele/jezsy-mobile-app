-- Fixes a gap in capsule_items' INSERT policy: it only checked that the
-- capsule being inserted into belongs to the caller, never that the
-- wardrobe_item_id being added belongs to that same caller. The mobile app's
-- own UI only ever offers the caller's own wardrobe items (see
-- app/wardrobe/capsule/[id].tsx's openPicker query), so this was not reachable
-- through normal use, but the database itself did not enforce it -- a
-- modified client could insert a capsule_items row referencing another
-- user's wardrobe_item_id into their own capsule. The referenced item still
-- would not render (wardrobe_items' own SELECT RLS continues to gate
-- visibility), but the row would persist and inflate unfiltered item counts.

DROP POLICY IF EXISTS "Users can insert own capsule items" ON capsule_items;
CREATE POLICY "Users can insert own capsule items" ON capsule_items FOR INSERT WITH CHECK (
    capsule_id IN (SELECT id FROM capsules WHERE user_id = auth.uid())
    AND wardrobe_item_id IN (SELECT id FROM wardrobe_items WHERE user_id = auth.uid())
);
