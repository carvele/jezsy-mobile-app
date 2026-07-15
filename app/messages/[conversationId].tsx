import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TextInput, 
  TouchableOpacity, KeyboardAvoidingView, Platform, SafeAreaView 
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useMessages } from '@/src/context/MessagesContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { sendMessage, markAsRead } = useMessages();
  
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!conversationId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
        
      if (!error && data) {
        setMessages(data);
      }
      setLoading(false);
      markAsRead(conversationId);
    };

    fetchMessages();

    const messageSubscription = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload: any) => {
          setMessages(prev => [...prev, payload.new]);
          if (payload.new.sender_id !== session?.user.id) {
            markAsRead(conversationId);
          }
        }
      )
      .subscribe();

    return () => {
      messageSubscription.unsubscribe();
    };
  }, [conversationId]);

  const handleSend = async () => {
    if (!inputText.trim() || !conversationId) return;
    const textToSend = inputText.trim();
    setInputText('');
    
    // Optimistic UI update
    const tempMsg = {
      id: 'temp-' + Date.now(),
      text: textToSend,
      sender_id: session?.user.id,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempMsg]);

    const result = await sendMessage(conversationId, textToSend);
    if (!result) {
      // Revert if failed
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setInputText(textToSend);
    } else {
      // Replace temp message with real one
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? result : m));
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.sender_id === session?.user.id;
    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
        <View style={[styles.messageBubble, isMe ? styles.messageBubbleMe : styles.messageBubbleThem]}>
          <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextThem]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen 
        options={{ 
          title: 'Chat',
          headerShown: true,
          headerBackTitle: 'Back',
        }} 
      />
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
        
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} 
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <IconSymbol name="arrow.up.circle.fill" size={32} color={inputText.trim() ? '#000' : '#ccc'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  messageBubbleMe: {
    backgroundColor: '#000',
    borderBottomRightRadius: 4,
  },
  messageBubbleThem: {
    backgroundColor: '#e5e5ea',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  messageTextMe: {
    color: '#fff',
  },
  messageTextThem: {
    color: '#000',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 16,
    marginRight: 8,
  },
  sendButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    width: 40,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
