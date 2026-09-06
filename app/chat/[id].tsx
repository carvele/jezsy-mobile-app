import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Database } from '@/src/types/database.types';

type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'];

export default function P2PChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // other user id
  const { user } = useAuth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { showToast } = useToast();
  const flatListRef = useRef<FlatList>(null);

  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessageRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [canMessage, setCanMessage] = useState(false);
  const [otherUser, setOtherUser] = useState<any>(null);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;

    const loadMessages = async (cId: string) => {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('chat_id', cId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (cancelled) return;

      if (error) {
        console.log('Error loading messages', error);
      } else {
        setMessages(data || []);
        // Mark unread as read
        data?.forEach(m => {
          if (m.sender_id !== user?.id && !m.read_at) markRead(m.id);
        });
      }
    };

    const initChat = async () => {
      try {
        setLoading(true);

        // profiles' own RLS only allows a row's owner or staff to read it, so
        // the other participant's row must go through this accessor.
        const { data: profileRows } = await supabase
          .rpc('get_public_profiles', { p_user_ids: [id] });
        
        if (cancelled) return;
        setOtherUser(profileRows?.[0] ?? null);

        // Check Connection
        const u1 = user.id < id ? user.id : id;
        const u2 = user.id < id ? id : user.id;
        const { data: conn } = await supabase
          .from('connections')
          .select('status')
          .eq('user_id_1', u1)
          .eq('user_id_2', u2)
          .single();
        
        if (cancelled) return;
        setCanMessage(conn?.status === 'accepted');

        if (conn?.status === 'accepted') {
          // RPC to get or create chat
          const { data: cId, error: rpcError } = await supabase.rpc('get_or_create_direct_chat' as any, { other_user_id: id }) as any;
          if (rpcError) throw rpcError;
          if (cancelled) return;
          setChatId(cId);

          if (cId) {
            await loadMessages(cId);
          }
        } else {
          // If not accepted, we might still have a past chat history
          const { data: chats } = await supabase
            .from('direct_chat_participants')
            .select('chat_id')
            .eq('user_id', user.id);
          
          if (cancelled) return;

          if (chats && chats.length > 0) {
            const chatIds = chats.map(c => c.chat_id);
            const { data: otherParticipant } = await supabase
              .from('direct_chat_participants')
              .select('chat_id')
              .in('chat_id', chatIds)
              .eq('user_id', id);

            if (cancelled) return;

            if (otherParticipant && otherParticipant.length > 0) {
              const historicalChatId = otherParticipant[0].chat_id;
              setChatId(historicalChatId);
              await loadMessages(historicalChatId);
            }
          }
        }
      } catch (err: any) { 
        if (cancelled) return;
        console.log('Error init chat:', err);
        showToast('Error loading chat', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initChat();

    return () => {
      cancelled = true;
    };
  }, [user, id]);

  useEffect(() => {
    if (!chatId) return;

    const channel = supabase
      .channel(`chat_${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `chat_id=eq.${chatId}`
      }, (payload) => {
        setMessages(prev => [payload.new as DirectMessageRow, ...prev]);
        markRead(payload.new.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  const markRead = async (msgId: string) => {
    await supabase.rpc('mark_direct_message_read', { p_message_id: msgId });
  };

  const handleSend = async () => {
    if (!inputText.trim() || !chatId || !user) return;

    const content = inputText.trim();
    setInputText('');

    try {
      const { error } = await supabase
        .from('direct_messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
          content
        });
      
      if (error) throw error;
    } catch (err: any) { console.log(err);
      showToast('Failed to send message', 'error');
      // Revert input text if it failed
      setInputText(content);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActivityIndicator color={colors.tint} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>@{otherUser?.username || 'Unknown'}</Text>
          <View style={{ width: 40 }} />
        </View>

        {!canMessage && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>You can no longer reply to this conversation.</Text>
          </View>
        )}

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          inverted
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const isMe = item.sender_id === user?.id;
            return (
              <View style={[
                styles.messageBubble,
                isMe ? [styles.myBubble, { backgroundColor: colors.tint }] : [styles.theirBubble, { backgroundColor: colors.surface, borderColor: colors.border }]
              ]}>
                <Text style={[styles.messageText, { color: isMe ? '#fff' : colors.text }]}>{item.content}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No messages yet. Say hello!</Text>
          }
        />

        <View style={[styles.inputContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            placeholder="Type a message..."
            placeholderTextColor={colors.secondaryText}
            value={inputText}
            onChangeText={setInputText}
            multiline
            editable={canMessage}
          />
          <TouchableOpacity 
            style={[styles.sendBtn, { backgroundColor: !inputText.trim() || !canMessage ? colors.border : colors.tint }]} 
            onPress={handleSend}
            disabled={!inputText.trim() || !canMessage}
          >
            <IconSymbol name="arrow.up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  warningBanner: {
    backgroundColor: '#333',
    padding: Spacing.sm,
    alignItems: 'center',
  },
  warningText: {
    ...Type.caption,
    color: '#fff',
  },
  messageList: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  myBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  messageText: {
    ...Type.body,
  },
  emptyText: {
    ...Type.caption,
    textAlign: 'center',
    marginTop: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    ...Type.body,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing.md,
  }
});
