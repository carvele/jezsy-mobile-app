import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useAuth } from './AuthContext';

type Conversation = Database['public']['Tables']['conversations']['Row'];
type Message = Database['public']['Tables']['messages']['Row'];

// What a message is regarding, so staff see the subject of an inquiry.
export type MessageContext = {
  type: 'product' | 'reservation' | 'order';
  ref?: string | null;
  label: string;
};

interface MessagesContextType {
  conversations: Conversation[];
  unreadCount: number;
  loading: boolean;
  sendMessage: (conversationId: string, text: string, imageUrl?: string, context?: MessageContext) => Promise<Message | null>;
  editMessage: (messageId: string, text: string) => Promise<Message | null>;
  toggleReaction: (messageId: string, emoji: string) => Promise<Record<string, string> | null>;
  markAsRead: (conversationId: string) => Promise<void>;
  getOrCreateConversation: () => Promise<Conversation | null>;
  refreshConversations: () => Promise<void>;
}

const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

export const MessagesProvider = ({ children }: { children: ReactNode }) => {
  const { session, profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);

  const refreshConversations = useCallback(async () => {
    if (!session?.user.id) return;
    
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('last_message_time', { ascending: false });
        
      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) {
      setConversations([]);
      setLoading(false);
      return;
    }

    refreshConversations();

    // Realtime subscription for conversation updates
    const subscription = supabase
      .channel(`user-conversations:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          refreshConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [session?.user.id, refreshConversations]);

  const sendMessage = useCallback(async (
    conversationId: string,
    text: string,
    imageUrl?: string,
    context?: MessageContext
  ) => {
    if (!session?.user.id) return null;

    try {
      const isStaff = profile?.role === 'staff' || profile?.role === 'admin' || profile?.role === 'owner';
      const senderName = profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : (isStaff ? 'Boutique Support' : 'Customer');
      const payload: any = {
        conversation_id: conversationId,
        sender_id: session.user.id,
        sender_role: isStaff ? 'staff' : 'customer',
        sender_name: senderName,
        text: text.trim(),
        image_url: imageUrl || null,
      };
      if (context) {
        payload.context_type = context.type;
        payload.context_ref = context.ref ?? null;
        payload.context_label = context.label;
      }
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single();

      if (messageError) throw messageError;

      return message;
    } catch (error) {
      console.error('Error sending message:', error);
      return null;
    }
  }, [session?.user.id, profile?.role, profile?.first_name, profile?.last_name]);

  const editMessage = useCallback(async (messageId: string, text: string) => {
    if (!session?.user.id) return null;

    const trimmed = text.trim();
    if (!trimmed) return null;

    try {
      const { data, error } = await supabase
        .from('messages')
        .update({ text: trimmed, edited_at: new Date().toISOString() } as any)
        .eq('id', messageId)
        .eq('sender_id', session.user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error editing message:', error);
      return null;
    }
  }, [session?.user.id]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!session?.user.id) return null;

    try {
      const { data, error } = await supabase.rpc('merge_message_reaction', {
        p_message_id: messageId,
        p_user_id: session.user.id,
        p_emoji: emoji,
      });

      if (error) throw error;
      return (data ?? {}) as Record<string, string>;
    } catch (error) {
      console.error('Error toggling reaction:', error);
      return null;
    }
  }, [session?.user.id]);

  const markAsRead = useCallback(async (conversationId: string) => {
    try {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId);

      // Also mark messages as read
      await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .is('read_at', null)
        .neq('sender_id', session?.user.id || '');
        
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }, [session?.user.id]);

  const getOrCreateConversation = useCallback(async () => {
    if (!session?.user.id) return null;

    try {
      const { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('customer_id', session.user.id)
        .single();

      if (existing) return existing;

      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          customer_id: session.user.id,
          unread_count: 0,
        })
        .select()
        .single();

      if (createError) throw createError;
      
      setConversations(prev => [newConv, ...prev]);
      return newConv;
    } catch (error) {
      if ((error as any).code === 'PGRST116') {
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            customer_id: session?.user.id,
            unread_count: 0,
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating conversation:', createError);
          return null;
        }
        setConversations(prev => [newConv, ...prev]);
        return newConv;
      }
      console.error('Error getting/creating conversation:', error);
      return null;
    }
  }, [session?.user.id]);

  const value = useMemo(() => ({
    conversations,
    unreadCount,
    loading,
    sendMessage,
    editMessage,
    toggleReaction,
    markAsRead,
    getOrCreateConversation,
    refreshConversations,
  }), [
    conversations,
    unreadCount,
    loading,
    sendMessage,
    editMessage,
    toggleReaction,
    markAsRead,
    getOrCreateConversation,
    refreshConversations,
  ]);

  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
};

export const useMessages = () => {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }
  return context;
};
