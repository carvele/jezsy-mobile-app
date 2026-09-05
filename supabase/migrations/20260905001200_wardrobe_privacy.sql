-- Add wardrobe_privacy column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS wardrobe_privacy text DEFAULT 'private' CHECK (wardrobe_privacy IN ('private', 'connections'));

-- Allow users to see wardrobe items if they are connected and privacy allows it
-- We create an additional SELECT-only policy. The existing ALL policy already covers owners and staff.
CREATE POLICY "Enable SELECT for mutual connections on shared wardrobes"
ON public.wardrobe_items FOR SELECT
TO public
USING (
    -- The owner has shared their wardrobe with connections
    EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = wardrobe_items.user_id 
        AND p.wardrobe_privacy = 'connections'
    )
    -- AND there is an accepted mutual connection between the viewer and the owner
    AND EXISTS (
        SELECT 1 FROM public.connections c
        WHERE c.status = 'accepted'
        AND (
            (c.user_id_1 = auth.uid() AND c.user_id_2 = wardrobe_items.user_id) OR
            (c.user_id_1 = wardrobe_items.user_id AND c.user_id_2 = auth.uid())
        )
    )
);
