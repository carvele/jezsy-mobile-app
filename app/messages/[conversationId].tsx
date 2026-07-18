import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TextInput, 
  TouchableOpacity, KeyboardAvoidingView, Platform, Image, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useMessages } from '@/src/context/MessagesContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { session } = useAuth();
  const { sendMessage, markAsRead } = useMessages();
  
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
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
          setMessages(prev => {
            if (prev.find(m => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          if (payload.new.sender_id !== session?.user.id) {
            markAsRead(conversationId);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload: any) => {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
        }
      )
      .subscribe();

    return () => {
      messageSubscription.unsubscribe();
    };
  }, [conversationId, markAsRead, session?.user.id]);

  const handleSend = async () => {
    if (!inputText.trim() || !conversationId) return;
    const textToSend = inputText.trim();
    setInputText('');
    
    // Optimistic UI update
    const tempMsg = {
      id: 'temp-' + Date.now(),
      text: textToSend,
      sender_id: session?.user.id,
      created_at: new Date().toISOString(),
      read_at: null,
      image_url: null
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

  const handlePickImage = async () => {
    if (!conversationId) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        const asset = result.assets[0];
        
        // Optimistic Image UI
        const tempMsg = {
          id: 'temp-' + Date.now(),
          text: '',
          sender_id: session?.user.id,
          created_at: new Date().toISOString(),
          read_at: null,
          image_url: asset.uri // temporary local uri
        };
        setMessages(prev => [...prev, tempMsg]);

        const ext = asset.uri.split('.').pop() || 'jpg';
        const fileName = `${Date.now()}.${ext}`;
        const filePath = `${session?.user.id}/${fileName}`;
        
        // Try to upload to 'products' bucket since it is confirmed to be public and functional
        // Alternatively we use 'messages' or 'chat_images' but they might not exist/be public
        let publicUrl = '';
        const { error } = await supabase.storage.from('products').upload(filePath, decode(asset.base64), { contentType: `image/${ext}` });
        
        if (!error) {
          const { data } = supabase.storage.from('products').getPublicUrl(filePath);
          publicUrl = data.publicUrl;
        }

        if (publicUrl) {
          const realMsg = await sendMessage(conversationId, '', publicUrl);
          if (realMsg) {
             setMessages(prev => prev.map(m => m.id === tempMsg.id ? realMsg : m));
          } else {
             setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
             Alert.alert("Error", "Failed to send image message.");
          }
        } else {
          setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
          Alert.alert("Upload Failed", "Could not upload the image to storage.");
        }
      }
    } catch (e) {
      console.error('Error picking/uploading image:', e);
      Alert.alert("Error", "An unexpected error occurred while picking the image.");
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.sender_id === session?.user.id;
    const timeString = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
        <View style={isMe ? styles.messageContentMe : styles.messageContentThem}>
          <View style={[styles.messageBubble, isMe ? styles.messageBubbleMe : styles.messageBubbleThem]}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.messageImage} resizeMode="cover" />
            ) : null}
            {item.text ? (
              <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextThem]}>
                {item.text}
              </Text>
            ) : null}
          </View>
          <View style={styles.metaContainer}>
            {isMe && item.read_at && (
               <Text style={styles.readReceiptText}>Read • </Text>
            )}
            <Text style={styles.timestampText}>{timeString}</Text>
          </View>
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
          <TouchableOpacity 
            style={styles.attachButton} 
            onPress={handlePickImage}
            accessibilityRole="button"
            accessibilityLabel="Attach image"
          >
            <IconSymbol name="camera.fill" size={24} color="#666" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} 
            onPress={handleSend}
            disabled={!inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <IconSymbol name="arrow.up.circle.fill" size={22} color="#fff" />
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
    marginBottom: 16,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  messageContentMe: {
    alignItems: 'flex-end',
    maxWidth: '80%',
  },
  messageContentThem: {
    alignItems: 'flex-start',
    maxWidth: '80%',
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
  messageBubbleMe: {
    backgroundColor: '#000',
    borderBottomRightRadius: 4,
  },
  messageBubbleThem: {
    backgroundColor: '#e5e5ea',
    borderBottomLeftRadius: 4,
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 8,
    marginTop: -4,
    marginHorizontal: -8,
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
  metaContainer: {
    flexDirection: 'row',
    marginTop: 4,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  timestampText: {
    fontSize: 11,
    color: '#8e8e93',
  },
  readReceiptText: {
    fontSize: 11,
    color: '#0a7ea4',
    fontWeight: '600',
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
  attachButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    width: 40,
    marginRight: 8,
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
    borderRadius: 20,
    backgroundColor: '#000',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
});
