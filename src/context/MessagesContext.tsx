import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useAuth } from './AuthContext';

type Conversation = Database['public']['Tables']['conversations']['Row'];
type Message = Database['public']['Tables']['messages']['Row'];

interface MessagesContextType {
  conversations: Conversation[];
  unreadCount: number;
  loading: boolean;
  sendMessage: (conversationId: string, text: string, imageUrl?: string) => Promise<Message | null>;
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
    refreshConversations();

    if (!session?.user.id) return;

    // Subscribe to realtime updates on conversations
    const conversationSubscription = supabase
      .channel('public:conversations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload: any) => {
          refreshConversations();
        }
      )
      .subscribe();

    return () => {
      conversationSubscription.unsubscribe();
    };
  }, [session, refreshConversations]);

  const sendMessage = async (conversationId: string, text: string, imageUrl?: string) => {
    if (!session?.user.id) return null;

    try {
      // 1. Insert message
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: session.user.id,
          sender_name: profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : 'Customer',
          text,
          image_url: imageUrl || null,
        })
        .select()
        .single();

      if (messageError) throw messageError;

      // The parent conversation's last_message / last_message_time are updated
      // atomically by the sync_conversation_on_message DB trigger (see
      // supabase/migrations/20260720100000_conversation_last_message_trigger.sql),
      // so no separate client-side conversation update is needed here.
      return message;
    } catch (error) {
      console.error('Error sending message:', error);
      return null;
    }
  };

  const markAsRead = async (conversationId: string) => {
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
  };

  const getOrCreateConversation = async () => {
    if (!session?.user.id) return null;

    try {
      // Check if conversation already exists for this customer
      const { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('customer_id', session.user.id)
        .single();

      if (existing) return existing;

      // Create new conversation
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
      // If single() fails because no row, it throws error. Let's handle it properly:
      if ((error as any).code === 'PGRST116') {
        // Create new conversation
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
  };

  return (
    <MessagesContext.Provider
      value={{
        conversations,
        unreadCount,
        loading,
        sendMessage,
        markAsRead,
        getOrCreateConversation,
        refreshConversations
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

export const useMessages = () => {
  const context = useContext(MessagesContext);
  if (context === undefined) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }
  return context;
};
