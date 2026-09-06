-- Fix SOC-001: Blocked users can resurrect a connection the other party blocked
DROP POLICY IF EXISTS "Users can update their connections" ON public.connections;

CREATE POLICY "Users can update their connections"
ON public.connections FOR UPDATE
TO public
USING (
    -- Must be involved
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
    -- Prevent bypassing block via UPSERT on conflict
    AND NOT (status = 'blocked' AND action_user_id != auth.uid())
)
WITH CHECK (
    (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
    AND action_user_id = auth.uid()
);

-- Fix SOC-002: A user can unilaterally accept their own outgoing connection request
CREATE OR REPLACE FUNCTION public.prevent_self_accept()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' AND OLD.action_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot accept your own connection request';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS connections_prevent_self_accept ON public.connections;
CREATE TRIGGER connections_prevent_self_accept
BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_accept();
