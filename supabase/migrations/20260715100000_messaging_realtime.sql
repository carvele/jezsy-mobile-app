-- Add read_at to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Conversations RLS
DROP POLICY IF EXISTS "Customers can view own conversations" ON public.conversations;
CREATE POLICY "Customers can view own conversations" 
ON public.conversations FOR SELECT 
TO authenticated
USING (auth.uid() = customer_id OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
));

DROP POLICY IF EXISTS "Customers can insert own conversations" ON public.conversations;
CREATE POLICY "Customers can insert own conversations" 
ON public.conversations FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Customers can update own conversations" ON public.conversations;
CREATE POLICY "Customers can update own conversations" 
ON public.conversations FOR UPDATE 
TO authenticated
USING (auth.uid() = customer_id OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
));

-- Messages RLS
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations" 
ON public.messages FOR SELECT 
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = conversation_id 
    AND (c.customer_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
    ))
  )
);

DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public.messages;
CREATE POLICY "Users can insert messages in their conversations" 
ON public.messages FOR INSERT 
TO authenticated
WITH CHECK (
  auth.uid() = sender_id AND
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = conversation_id 
    AND (c.customer_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
    ))
  )
);

DROP POLICY IF EXISTS "Users can update their messages or mark as read" ON public.messages;
CREATE POLICY "Users can update their messages or mark as read" 
ON public.messages FOR UPDATE 
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = conversation_id 
    AND (c.customer_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
    ))
  )
);

-- Enable Realtime for both tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
END
$$;
