import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Image, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useMessages, MessageContext } from '@/src/context/MessagesContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { resolveChatImageUrl } from '@/src/utils/chatImageUrl';
import { formatDateSeparator, shouldStartMessageGroup } from '@/src/utils/dateTime';
import { useToast } from '@/src/context/ToastContext';

// One reaction per person per message, so this is a shortlist rather than a
// full picker -- matching the set the admin dashboard already offers.
const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

type ProductPreview = {
  id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  on_sale: boolean | null;
  image_url: string | null;
};

export default function ChatScreen() {
  const { showToast } = useToast();
  const { conversationId, ctxType, ctxRef, ctxLabel } = useLocalSearchParams<{
    conversationId: string;
    ctxType?: string;
    ctxRef?: string;
    ctxLabel?: string;
  }>();
  const { session } = useAuth();
  const { sendMessage, editMessage, toggleReaction, markAsRead } = useMessages();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  // Non-null while editing: the composer becomes an edit box for that message.
  const [editingId, setEditingId] = useState<string | null>(null);
  // The long-press target. Reactions apply to anyone's message; Edit only shows
  // for your own, so one sheet serves both.
  const [actionTarget, setActionTarget] = useState<any | null>(null);
  const [pendingContext, setPendingContext] = useState<MessageContext | null>(null);
  const [resolvedImageUrls, setResolvedImageUrls] = useState<Record<string, string>>({});
  const resolvedImageUrlsRef = useRef(resolvedImageUrls);
  resolvedImageUrlsRef.current = resolvedImageUrls;
  // null marks a product that was looked up and no longer exists, which stops
  // the effect below re-querying it on every message change.
  const [productPreviews, setProductPreviews] = useState<Record<string, ProductPreview | null>>({});
  const productPreviewsRef = useRef(productPreviews);
  productPreviewsRef.current = productPreviews;
  const flatListRef = useRef<FlatList>(null);

  // resolveChatImageUrl's signed URLs expire after an hour, but each message
  // is only ever resolved once (guarded by the `undefined` check below) --
  // a conversation left open past that point would show broken images with
  // no way to recover short of leaving and returning. Refocusing clears the
  // cache so every image message resolves again, cheap since a conversation
  // holds few of them.
  const [focusTick, setFocusTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setResolvedImageUrls({});
      setFocusTick(t => t + 1);
    }, [])
  );

  useEffect(() => {
    const toResolve = messages.filter(m => m.image_url && resolvedImageUrlsRef.current[m.id] === undefined);
    if (toResolve.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        toResolve.map(async (m) => [m.id, (await resolveChatImageUrl(m.image_url)) ?? ''] as const)
      );
      if (cancelled) return;
      setResolvedImageUrls(prev => {
        const next = { ...prev };
        for (const [id, url] of entries) next[id] = url;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, focusTick]);

  // Product-context messages render as a card, which needs the product itself.
  // Same shape as the image resolution above: fetch only what is missing.
  useEffect(() => {
    const missing = [
      ...new Set(
        messages
          .filter(m => m.context_type === 'product' && m.context_ref)
          .map(m => m.context_ref as string)
      ),
    ].filter(id => productPreviewsRef.current[id] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, price, sale_price, on_sale, image_url')
        .in('id', missing);
      if (cancelled) return;

      setProductPreviews(prev => {
        const next = { ...prev };
        for (const id of missing) next[id] = null;
        for (const product of data || []) next[product.id] = product as ProductPreview;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [messages]);

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

  // Prime the subject from the "Ask about this" entry point; it rides along on
  // the next message the user sends, then clears.
  useEffect(() => {
    if (ctxLabel && (ctxType === 'product' || ctxType === 'reservation' || ctxType === 'order')) {
      setPendingContext({ type: ctxType, ref: ctxRef ?? null, label: ctxLabel });
    }
  }, [ctxType, ctxRef, ctxLabel]);

  // Sender-only, text-only, and never a message still in flight: a temp- id has
  // no row to update yet.
  const canEdit = (item: any) =>
    item.sender_id === session?.user.id &&
    !!item.text &&
    !item.image_url &&
    !String(item.id).startsWith('temp-');

  const beginEdit = (item: any) => {
    if (!canEdit(item)) return;
    setEditingId(item.id);
    setInputText(item.text);
  };

  // An optimistic row has no database row yet, so neither action applies to it.
  const canAct = (item: any) => !String(item.id).startsWith('temp-');

  const handleReact = async (emoji: string) => {
    const target = actionTarget;
    setActionTarget(null);
    if (!target) return;

    const previous = target.reactions ?? {};
    const next = await toggleReaction(target.id, emoji);
    if (next === null) {
      showToast('Could not add that reaction.', 'error');
      return;
    }

    // The realtime UPDATE will also deliver this, but applying it here keeps the
    // tap feeling immediate; both converge on the same map.
    setMessages(prev =>
      prev.map(m => (m.id === target.id ? { ...m, reactions: next ?? previous } : m)),
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
    setInputText('');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const nextText = inputText.trim();
    if (!nextText) return;

    const target = messages.find((m) => m.id === editingId);
    if (target && target.text === nextText) {
      cancelEdit();
      return;
    }

    const editedAt = new Date().toISOString();
    // Optimistic, then reverted from the previous text if the update is refused.
    setMessages(prev =>
      prev.map(m => (m.id === editingId ? { ...m, text: nextText, edited_at: editedAt } : m)),
    );
    setEditingId(null);
    setInputText('');

    const result = await editMessage(editingId, nextText);
    if (!result) {
      setMessages(prev => prev.map(m => (m.id === editingId ? (target ?? m) : m)));
      showToast('Could not edit that message.', 'error');
    }
  };

  const handleSend = async () => {
    if (editingId) return handleSaveEdit();
    if (!inputText.trim() || !conversationId) return;
    const textToSend = inputText.trim();
    const contextToSend = pendingContext;
    setInputText('');

    // Optimistic UI update
    const tempMsg = {
      id: 'temp-' + Date.now(),
      text: textToSend,
      sender_id: session?.user.id,
      created_at: new Date().toISOString(),
      read_at: null,
      _status: 'sending' as const,
      image_url: null,
      context_label: contextToSend?.label ?? null,
      // Carried on the optimistic row too, so a product question renders as a
      // card immediately instead of switching from chip to card on the swap.
      context_type: contextToSend?.type ?? null,
      context_ref: contextToSend?.ref ?? null,
    };
    setMessages(prev => [...prev, tempMsg]);

    const result = await sendMessage(conversationId, textToSend, undefined, contextToSend ?? undefined);
    if (!result) {
      // Keep the failed message on screen rather than deleting it and pushing
      // the text back into the input: silently vanishing reads as "the app ate
      // my message", and there is nothing left to retry from.
      setMessages(prev => prev.map(m => (m.id === tempMsg.id ? { ...m, _status: 'failed' } : m)));
    } else {
      // Replace temp message with real one; context has now been attached.
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? result : m));
      if (contextToSend) setPendingContext(null);
    }
  };

  const handlePickImage = async () => {
    if (!conversationId) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
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

      let uploadedPath = '';
      const { error } = await supabase.storage.from('chat-images').upload(filePath, decode(asset.base64), { contentType: `image/${ext}` });

      if (!error) {
        uploadedPath = filePath;
      }

      if (uploadedPath) {
        const realMsg = await sendMessage(conversationId, '', uploadedPath);
        if (realMsg) {
           setMessages(prev => prev.map(m => m.id === tempMsg.id ? realMsg : m));
        } else {
           setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
           showToast('Could not send that photo. Please try again.', 'error');
        }
      } else {
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
        showToast('Could not upload that photo. Please try again.', 'error');
      }
    } catch (e) {
      console.error('Error picking/uploading image:', e);
      showToast('Could not open your photos. Please try again.', 'error');
    }
  };

  const handleRetrySend = async (msg: any) => {
    if (!conversationId) return;
    setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, _status: 'sending' } : m)));

    const context = msg.context_label
      ? { label: msg.context_label, type: msg.context_type, ref: msg.context_ref }
      : undefined;
    const result = await sendMessage(conversationId, msg.text, undefined, context);

    setMessages(prev =>
      prev.map(m => (m.id === msg.id ? (result ?? { ...m, _status: 'failed' }) : m)),
    );
  };

  // Only the newest of your own messages carries a status, as in most chat
  // apps: repeating "Sent" down the whole thread is noise. A failed message is
  // the exception -- it stays marked wherever it sits, because it is the one
  // state the sender has to act on.
  const lastOwnIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === session?.user.id) return i;
    }
    return -1;
  }, [messages, session?.user.id]);

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isMe = item.sender_id === session?.user.id;
    const timeString = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const previous = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldStartMessageGroup(previous?.created_at, item.created_at);

    // Falls back to the plain chip while the lookup is in flight, for a
    // deleted product, and for reservation/order contexts.
    const productPreview =
      item.context_type === 'product' && item.context_ref
        ? productPreviews[item.context_ref]
        : null;

    return (
      <>
        {showDateSeparator ? (
          <View style={styles.dateSeparator}>
            <Text style={[styles.dateSeparatorText, { color: colors.secondaryText }]}>
              {formatDateSeparator(item.created_at)}
            </Text>
          </View>
        ) : null}
        <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
        <View style={isMe ? styles.messageContentMe : styles.messageContentThem}>
          <TouchableOpacity
            activeOpacity={canAct(item) ? 0.7 : 1}
            onLongPress={() => canAct(item) && setActionTarget(item)}
            delayLongPress={300}
            disabled={!canAct(item)}
            accessibilityRole={canAct(item) ? 'button' : undefined}
            accessibilityHint={
              canAct(item)
                ? canEdit(item)
                  ? 'Long press to react or edit this message'
                  : 'Long press to react to this message'
                : undefined
            }
            style={[
              styles.messageBubble,
              isMe
                ? [styles.messageBubbleMe, { backgroundColor: colors.tint }]
                : [styles.messageBubbleThem, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }],
              editingId === item.id && { opacity: 0.55 },
            ]}
          >
            {productPreview ? (
              <TouchableOpacity
                style={[styles.productCard, { backgroundColor: isMe ? 'rgba(0,0,0,0.10)' : colors.background, borderColor: isMe ? 'rgba(0,0,0,0.12)' : colors.border }]}
                onPress={() => router.push(`/product/${item.context_ref}`)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Question about ${productPreview.name}. Opens the product page.`}
              >
                <Image
                  source={productPreview.image_url ? { uri: productPreview.image_url } : require('@/assets/images/partial-react-logo.png')}
                  style={styles.productCardImage}
                  resizeMode="cover"
                />
                <View style={styles.productCardBody}>
                  <Text style={[styles.productCardEyebrow, { color: isMe ? 'rgba(0,0,0,0.55)' : colors.secondaryText }]}>
                    Question about
                  </Text>
                  <Text style={[styles.productCardName, { color: isMe ? colors.onTint : colors.text }]} numberOfLines={2}>
                    {productPreview.name}
                  </Text>
                  <Text style={[styles.productCardPrice, { color: isMe ? colors.onTint : colors.tint }]}>
                    ₱{productPreview.on_sale && productPreview.sale_price ? productPreview.sale_price : productPreview.price}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={isMe ? 'rgba(0,0,0,0.4)' : colors.secondaryText} />
              </TouchableOpacity>
            ) : item.context_label ? (
              <View style={[styles.contextChip, { backgroundColor: isMe ? 'rgba(0,0,0,0.12)' : colors.background, borderColor: isMe ? 'transparent' : colors.border }]}>
                <Text style={[styles.contextChipText, { color: isMe ? colors.onTint : colors.secondaryText }]} numberOfLines={1}>
                  Re: {item.context_label}
                </Text>
              </View>
            ) : null}
            {item.image_url && resolvedImageUrls[item.id] ? (
              <Image source={{ uri: resolvedImageUrls[item.id] }} style={styles.messageImage} resizeMode="cover" />
            ) : null}
            {item.text ? (
              <Text style={[styles.messageText, { color: isMe ? colors.onTint : colors.text }]}>
                {item.text}
              </Text>
            ) : null}
          </TouchableOpacity>
          {(() => {
            // reactions is { userId: emoji }; collapse to emoji -> count and
            // highlight the one this user picked.
            const reactions: Record<string, string> = item.reactions ?? {};
            const entries = Object.entries(reactions);
            if (entries.length === 0) return null;

            const grouped = entries.reduce<Record<string, number>>((acc, [, emoji]) => {
              acc[emoji] = (acc[emoji] ?? 0) + 1;
              return acc;
            }, {});
            const mine = session?.user.id ? reactions[session.user.id] : undefined;

            return (
              <View style={[styles.reactionRow, isMe ? styles.reactionRowMe : styles.reactionRowThem]}>
                {Object.entries(grouped).map(([emoji, count]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.reactionPill,
                      {
                        backgroundColor: colors.card,
                        borderColor: mine === emoji ? colors.tint : colors.border,
                      },
                    ]}
                    onPress={() => toggleReaction(item.id, emoji).then(next => {
                      if (next) {
                        setMessages(prev =>
                          prev.map(m => (m.id === item.id ? { ...m, reactions: next } : m)),
                        );
                      }
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={`${emoji} ${count}`}
                    accessibilityHint={mine === emoji ? 'Removes your reaction' : 'Adds your reaction'}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    {count > 1 && (
                      <Text style={[styles.reactionCount, { color: colors.secondaryText }]}>{count}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            );
          })()}
          <View style={styles.metaContainer}>
            {isMe && (item._status || index === lastOwnIndex) && (
              item._status === 'failed' ? (
                <TouchableOpacity
                  onPress={() => handleRetrySend(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Message not sent. Tap to try again."
                >
                  <Text style={[styles.readReceiptText, { color: colors.error }]}>
                    Not sent. Tap to retry •{' '}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={[
                    styles.readReceiptText,
                    { color: item.read_at ? colors.tint : colors.secondaryText },
                  ]}
                  accessibilityLabel={
                    item._status === 'sending'
                      ? 'Sending'
                      : item.read_at
                        ? 'Read by the shop'
                        : 'Sent'
                  }
                >
                  {item._status === 'sending' ? 'Sending' : item.read_at ? 'Read' : 'Sent'} •{' '}
                </Text>
              )
            )}
            <Text style={[styles.timestampText, { color: colors.secondaryText }]}>{timeString}</Text>
            {item.edited_at ? (
              <Text style={[styles.timestampText, { color: colors.secondaryText }]}> • edited</Text>
            ) : null}
          </View>
        </View>
        </View>
      </>
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
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          // Product lookups land after the messages themselves, and that
          // resolution does not touch `data` -- without this the rows keep
          // rendering the fallback chip.
          extraData={productPreviews}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        <Modal
          visible={!!actionTarget}
          transparent
          animationType="fade"
          onRequestClose={() => setActionTarget(null)}
        >
          <TouchableOpacity
            style={styles.sheetOverlay}
            activeOpacity={1}
            onPress={() => setActionTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Close message actions"
          >
            <TouchableOpacity style={[styles.actionSheet, { backgroundColor: colors.card }]} activeOpacity={1}>
              <View style={styles.emojiRow}>
                {REACTION_EMOJI.map(emoji => {
                  const mine =
                    session?.user.id && (actionTarget?.reactions ?? {})[session.user.id] === emoji;
                  return (
                    <TouchableOpacity
                      key={emoji}
                      style={[
                        styles.emojiButton,
                        mine && { backgroundColor: colors.background, borderColor: colors.tint },
                      ]}
                      onPress={() => handleReact(emoji)}
                      accessibilityRole="button"
                      accessibilityLabel={`React with ${emoji}`}
                      accessibilityState={{ selected: !!mine }}
                    >
                      <Text style={styles.emojiButtonText}>{emoji}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {actionTarget && canEdit(actionTarget) && (
                <TouchableOpacity
                  style={[styles.actionRow, { borderTopColor: colors.border }]}
                  onPress={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    beginEdit(target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Edit message"
                >
                  <IconSymbol name="checkmark" size={18} color={colors.tint} />
                  <Text style={[styles.actionRowText, { color: colors.text }]}>Edit message</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {editingId && (
          <View style={[styles.contextBanner, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <IconSymbol name="checkmark" size={14} color={colors.tint} />
            <Text style={[styles.contextBannerText, { color: colors.text }]} numberOfLines={1}>
              Editing message
            </Text>
            <TouchableOpacity
              onPress={cancelEdit}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={14} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>
        )}

        {pendingContext && !editingId && (
          <View style={[styles.contextBanner, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <IconSymbol name="tag.fill" size={14} color={colors.tint} />
            <Text style={[styles.contextBannerText, { color: colors.text }]} numberOfLines={1}>
              Re: {pendingContext.label}
            </Text>
            <TouchableOpacity
              onPress={() => setPendingContext(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear message subject"
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={14} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {/* Attaching an image mid-edit would send a new message rather than
              change the one being edited, so it is hidden while editing. */}
          {!editingId && (
            <TouchableOpacity
              style={styles.attachButton}
              onPress={handlePickImage}
              accessibilityRole="button"
              accessibilityLabel="Attach image"
            >
              <IconSymbol name="camera.fill" size={24} color={colors.secondaryText} />
            </TouchableOpacity>
          )}
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
            placeholder={editingId ? 'Edit your message...' : 'Type a message...'}
            placeholderTextColor={colors.secondaryText}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType={editingId ? 'done' : 'send'}
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
            accessibilityLabel={editingId ? 'Edit message' : 'Message input'}
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: inputText.trim() ? colors.tint : colors.border }]}
            onPress={handleSend}
            disabled={!inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel={editingId ? 'Save changes' : 'Send message'}
          >
            <IconSymbol
              name={editingId ? 'checkmark' : 'arrow.up.circle.fill'}
              size={22}
              color={inputText.trim() ? colors.onTint : colors.secondaryText}
            />
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: Spacing.xs,
    width: 32,
  },
  headerTitle: {
    ...Type.subtitle,
  },
  container: {
    flex: 1,
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: Spacing.lg,
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
    paddingHorizontal: Spacing.lg,
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
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    marginTop: -4,
    marginHorizontal: -8,
  },
  messageText: {
    ...Type.bodyLarge,
  },
  metaContainer: {
    flexDirection: 'row',
    marginTop: Spacing.xs,
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  timestampText: {
    ...Type.caption,
  },
  readReceiptText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reactionRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  reactionRowMe: { justifyContent: 'flex-end' },
  reactionRowThem: { justifyContent: 'flex-start' },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 12, fontWeight: '600' },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 36 : 16,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  emojiButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiButtonText: { fontSize: 24 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRowText: { ...Type.bodyStrong },
  dateSeparator: {
    alignItems: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 220,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
    // Cancels the bubble's own horizontal padding so the card reads as a
    // distinct panel inset in the bubble rather than a floating box.
    marginHorizontal: -8,
    marginTop: -2,
  },
  productCardImage: {
    width: 44,
    height: 56,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  productCardBody: {
    flex: 1,
    gap: 1,
  },
  productCardEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  productCardName: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  productCardPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
  contextChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
    maxWidth: 220,
  },
  contextChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  contextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: Spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-end',
  },
  attachButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    width: 40,
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 120,
    // Size only, not Type.bodyLarge: a lineHeight on an Android TextInput
    // shifts the baseline, and this one grows as you type.
    fontSize: 16,
    marginRight: Spacing.sm,
  },
  sendButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    width: 40,
    borderRadius: 20,
  },
});
