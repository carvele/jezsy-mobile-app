import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
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
  markDelivered: (conversationId: string) => Promise<void>;
  getOrCreateConversation: () => Promise<Conversation | null>;
  refreshConversations: () => Promise<void>;
  /** user_id -> role, live across both this app and the admin dashboard (same presence channel). */
  onlineUsers: Record<string, string>;
  /** True if any staff/admin/owner is currently online -- conversations here are with the team, not one person. */
  isStaffOnline: boolean;
}

const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

export const MessagesProvider = ({ children }: { children: ReactNode }) => {
  const { session, profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<Record<string, string>>({});

  const isStaff = profile?.role === 'staff' || profile?.role === 'owner';
  const unreadCount = conversations.reduce(
    (sum, conv) => sum + (isStaff ? (conv.unread_staff || 0) : (conv.unread_customer || 0)),
    0
  );

  const isStaffOnline = Object.values(onlineUsers).some(
    (role) => role === 'staff' || role === 'owner'
  );

  // Shared presence channel: 'presence:online' is the same channel name the
  // admin dashboard tracks itself on, so a staff member's browser tab and a
  // customer's phone see each other's live online state through Supabase
  // Realtime -- no extra table or polling needed.
  useEffect(() => {
    if (!session?.user.id) {
      setOnlineUsers({});
      return;
    }

    const channel = supabase.channel('presence:online', {
      config: { presence: { key: session.user.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ user_id: string; role: string }>();
        const next: Record<string, string> = {};
        for (const presences of Object.values(state)) {
          const p = presences[0];
          if (p) next[p.user_id] = p.role;
        }
        setOnlineUsers(next);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: session.user.id,
            role: profile?.role || 'customer',
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id, profile?.role]);

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

    // Realtime subscription for conversation and message updates
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          refreshConversations();

          // Marks a message Delivered the instant it lands while this app is
          // running and subscribed, regardless of whether the recipient has
          // that specific conversation open -- the same live signal the
          // admin dashboard uses on its side. A message sent while this app
          // is fully closed still gets caught by the conversation screen's
          // catch-up call to markDelivered on open.
          if (payload.eventType !== 'INSERT') return;
          const msg = payload.new;
          if (msg && msg.sender_id && msg.sender_id !== session.user.id && !msg.delivered_at) {
            supabase
              .from('messages')
              .update({ delivered_at: new Date().toISOString() })
              .eq('id', msg.id)
              .is('delivered_at', null)
              .then(({ error }) => {
                if (error) console.error('Error marking message delivered:', error);
              });
          }
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
      const isStaff = profile?.role === 'staff' || profile?.role === 'owner';
      const senderName = profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : (isStaff ? 'Boutique Support' : 'Customer');
      const payload: Database['public']['Tables']['messages']['Insert'] = {
        conversation_id: conversationId,
        sender_id: session.user.id,
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
        .update({ text: trimmed, edited_at: new Date().toISOString() })
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
      // Only the current side's unread count clears -- a staff member
      // reading a conversation shouldn't silently mark it read for the
      // customer, and vice versa.
      await supabase
        .from('conversations')
        .update(isStaff ? { unread_staff: 0 } : { unread_customer: 0 })
        .eq('id', conversationId);

      const nowIso = new Date().toISOString();

      // Reading implies delivery -- catches the case where read_at is being
      // set without delivered_at ever having been stamped (e.g. the app was
      // closed when the message arrived, so no realtime INSERT fired for
      // it). is('delivered_at', null) means an earlier, real delivery time
      // is never overwritten.
      await supabase
        .from('messages')
        .update({ delivered_at: nowIso })
        .eq('conversation_id', conversationId)
        .is('delivered_at', null)
        .neq('sender_id', session?.user.id || '');

      await supabase
        .from('messages')
        .update({ read_at: nowIso })
        .eq('conversation_id', conversationId)
        .is('read_at', null)
        .neq('sender_id', session?.user.id || '');

    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }, [session?.user.id, isStaff]);

  // Bulk catch-up for messages that arrived while this app was fully closed
  // (so no realtime INSERT could have marked them) -- called when the chat
  // screen fetches a conversation's history.
  const markDelivered = useCallback(async (conversationId: string) => {
    try {
      await supabase
        .from('messages')
        .update({ delivered_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .is('delivered_at', null)
        .neq('sender_id', session?.user.id || '');
    } catch (error) {
      console.error('Error marking delivered:', error);
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
          unread_customer: 0,
          unread_staff: 0,
        })
        .select()
        .single();

      if (createError) throw createError;
      
      setConversations(prev => [newConv, ...prev]);
      return newConv;
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'PGRST116') {
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            customer_id: session?.user.id,
            unread_customer: 0,
            unread_staff: 0,
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
    markDelivered,
    getOrCreateConversation,
    refreshConversations,
    onlineUsers,
    isStaffOnline,
  }), [
    conversations,
    unreadCount,
    loading,
    sendMessage,
    editMessage,
    toggleReaction,
    markAsRead,
    markDelivered,
    getOrCreateConversation,
    refreshConversations,
    onlineUsers,
    isStaffOnline,
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
