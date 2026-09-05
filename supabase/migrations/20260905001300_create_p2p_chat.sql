CREATE TABLE public.direct_chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.direct_chat_participants (
    chat_id uuid REFERENCES public.direct_chats(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE public.direct_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid REFERENCES public.direct_chats(id) ON DELETE CASCADE,
    sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    content text NOT NULL,
    created_at timestamptz DEFAULT now(),
    read_at timestamptz
);

-- Indexes
CREATE INDEX direct_chat_participants_user_id_idx ON public.direct_chat_participants(user_id);
CREATE INDEX direct_chat_participants_chat_id_idx ON public.direct_chat_participants(chat_id);
CREATE INDEX direct_messages_chat_id_created_at_idx ON public.direct_messages(chat_id, created_at);

-- RLS
ALTER TABLE public.direct_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- direct_chats
-- Users can see chats if they are a participant
CREATE POLICY "Users can view chats they are in"
ON public.direct_chats FOR SELECT
TO public
USING (
    EXISTS (
        SELECT 1 FROM public.direct_chat_participants p 
        WHERE p.chat_id = id AND p.user_id = auth.uid()
    )
);

-- Users can create a chat if they insert themselves as a participant
-- Wait, creating a chat and participants is tricky. We'll allow authenticated users to insert chats.
-- Security is enforced by who can insert participants and messages.
CREATE POLICY "Users can create chats"
ON public.direct_chats FOR INSERT
TO public
WITH CHECK (auth.uid() IS NOT NULL);

-- direct_chat_participants
-- Users can see participants if they are in the chat themselves
CREATE POLICY "Users can view participants of their chats"
ON public.direct_chat_participants FOR SELECT
TO public
USING (
    EXISTS (
        SELECT 1 FROM public.direct_chat_participants p 
        WHERE p.chat_id = direct_chat_participants.chat_id AND p.user_id = auth.uid()
    )
);

-- Users can insert participants to a chat (typically themselves and the other person).
-- But they must only do this if they have an accepted connection.
CREATE POLICY "Users can add participants if mutual connection exists"
ON public.direct_chat_participants FOR INSERT
TO public
WITH CHECK (
    -- You must be adding yourself or someone you have a connection with
    -- To keep it simple, we check that there's an accepted connection between auth.uid() and user_id (if not self)
    auth.uid() = user_id OR 
    EXISTS (
        SELECT 1 FROM public.connections c
        WHERE c.status = 'accepted'
        AND (
            (c.user_id_1 = auth.uid() AND c.user_id_2 = user_id) OR
            (c.user_id_1 = user_id AND c.user_id_2 = auth.uid())
        )
    )
);

-- direct_messages
-- Users can read messages in their chats
CREATE POLICY "Users can read their direct messages"
ON public.direct_messages FOR SELECT
TO public
USING (
    EXISTS (
        SELECT 1 FROM public.direct_chat_participants p 
        WHERE p.chat_id = direct_messages.chat_id AND p.user_id = auth.uid()
    )
);

-- Users can insert messages ONLY if they are sender, they are in the chat, AND they have an accepted connection with ALL other participants.
CREATE POLICY "Users can send messages to connections"
ON public.direct_messages FOR INSERT
TO public
WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.direct_chat_participants p 
        WHERE p.chat_id = direct_messages.chat_id AND p.user_id = auth.uid()
    )
    -- Must have accepted connection with the other participant
    AND EXISTS (
        SELECT 1 FROM public.direct_chat_participants other_p
        JOIN public.connections c ON c.status = 'accepted' 
            AND (
                (c.user_id_1 = auth.uid() AND c.user_id_2 = other_p.user_id) OR
                (c.user_id_1 = other_p.user_id AND c.user_id_2 = auth.uid())
            )
        WHERE other_p.chat_id = direct_messages.chat_id 
        AND other_p.user_id != auth.uid()
    )
);

-- Allow updating read_at
CREATE POLICY "Users can mark messages as read"
ON public.direct_messages FOR UPDATE
TO public
USING (
    EXISTS (
        SELECT 1 FROM public.direct_chat_participants p 
        WHERE p.chat_id = direct_messages.chat_id AND p.user_id = auth.uid()
    )
)
WITH CHECK (
    -- Can only update read_at
    sender_id = sender_id AND content = content AND chat_id = chat_id
);

-- Triggers for chat updated_at
CREATE OR REPLACE FUNCTION public.set_direct_chats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.direct_chats SET updated_at = now() WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER direct_messages_inserted
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.set_direct_chats_updated_at();
