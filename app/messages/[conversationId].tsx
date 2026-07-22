import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Image, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useMessages } from '@/src/context/MessagesContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { session } = useAuth();
  const { sendMessage, markAsRead } = useMessages();
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

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

      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) return;

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

      let publicUrl = '';
      const { error } = await supabase.storage.from('chat-images').upload(filePath, decode(asset.base64), { contentType: `image/${ext}` });

      if (!error) {
        const { data } = supabase.storage.from('chat-images').getPublicUrl(filePath);
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
          <View
            style={[
              styles.messageBubble,
              isMe
                ? [styles.messageBubbleMe, { backgroundColor: colors.tint }]
                : [styles.messageBubbleThem, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }],
            ]}
          >
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.messageImage} resizeMode="cover" />
            ) : null}
            {item.text ? (
              <Text style={[styles.messageText, { color: isMe ? '#0D0D0D' : colors.text }]}>
                {item.text}
              </Text>
            ) : null}
          </View>
          <View style={styles.metaContainer}>
            {isMe && item.read_at && (
               <Text style={[styles.readReceiptText, { color: colors.tint }]}>Read • </Text>
            )}
            <Text style={[styles.timestampText, { color: colors.secondaryText }]}>{timeString}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Shop Owner</Text>
        <View style={{ width: 32 }} />
      </View>

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

        <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={handlePickImage}
            accessibilityRole="button"
            accessibilityLabel="Attach image"
          >
            <IconSymbol name="camera.fill" size={24} color={colors.secondaryText} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
            placeholder="Type a message..."
            placeholderTextColor={colors.secondaryText}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
            accessibilityLabel="Message input"
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: inputText.trim() ? colors.tint : colors.border }]}
            onPress={handleSend}
            disabled={!inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <IconSymbol name="arrow.up.circle.fill" size={22} color={inputText.trim() ? '#0D0D0D' : colors.secondaryText} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 4,
    width: 32,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  container: {
    flex: 1,
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
    borderBottomRightRadius: 4,
  },
  messageBubbleThem: {
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
  metaContainer: {
    flexDirection: 'row',
    marginTop: 4,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  timestampText: {
    fontSize: 11,
  },
  readReceiptText: {
    fontSize: 11,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  },
});
