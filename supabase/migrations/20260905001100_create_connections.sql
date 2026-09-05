CREATE TABLE public.connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id_1 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_id_2 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
    action_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT connections_user_order CHECK (user_id_1 < user_id_2),
    CONSTRAINT connections_no_self CHECK (user_id_1 != user_id_2),
    UNIQUE (user_id_1, user_id_2)
);

CREATE INDEX connections_user_id_1_idx ON public.connections(user_id_1);
CREATE INDEX connections_user_id_2_idx ON public.connections(user_id_2);
CREATE INDEX connections_status_idx ON public.connections(status);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Users can see connection records they are a part of, UNLESS they are blocked by the other user.
-- Wait, if they are blocked by the other user, the status is 'blocked' and action_user_id != auth.uid().
-- In the matrix: View connection record: ❌ (hidden from blocked).
CREATE POLICY "Users can view their non-blocked connections" 
ON public.connections FOR SELECT 
TO public
USING (
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2) 
    AND NOT (
        status = 'blocked' AND action_user_id != auth.uid()
    )
);

-- Staff can view all connections
CREATE POLICY "Staff can view all connections" 
ON public.connections FOR SELECT 
TO public
USING (public.is_staff_or_admin());

-- Users can insert a new pending connection
CREATE POLICY "Users can insert pending connections"
ON public.connections FOR INSERT
TO public
WITH CHECK (
    -- Must be involved
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
    -- Must be the action_user_id
    AND auth.uid() = action_user_id
    -- Must start as pending or blocked (users can immediately block)
    AND status IN ('pending', 'blocked')
);

-- Users can update connections
CREATE POLICY "Users can update their connections"
ON public.connections FOR UPDATE
TO public
USING (
    -- Must be involved
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
)
WITH CHECK (
    -- You can't update if you were blocked by the other person
    -- This relies on the SELECT policy already filtering out rows where you are blocked.
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
    -- Must update action_user_id to self
    AND action_user_id = auth.uid()
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.set_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connections_updated_at
BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.set_connections_updated_at();
