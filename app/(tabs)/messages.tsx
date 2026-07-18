import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMessages } from '@/src/context/MessagesContext';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';

export default function InboxScreen() {
  const { conversations, loading: messagesLoading } = useMessages();
  const { user, profile } = useAuth();
  const router = useRouter();
  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];

  const [activeTab, setActiveTab] = useState<'messages' | 'notifications'>('messages');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setNotificationsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    try {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', user.id);
    } catch (e) {
      console.error(e);
    }
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'order': return 'bag.fill';
      case 'reservation': return 'calendar';
      case 'promo': return 'tag.fill';
      case 'system': return 'info.circle.fill';
      default: return 'bell.fill';
    }
  };

  const renderMessageItem = ({ item }: { item: any }) => {
    const isStaff = profile?.role === 'admin' || profile?.role === 'owner';
    const displayName = isStaff ? `Customer (${item.customer_id.substring(0, 6)})` : 'Shop Owner';

    const dateStr = item.last_message_time
      ? new Date(item.last_message_time).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    return (
      <TouchableOpacity
        style={[styles.conversationItem, { borderBottomColor: colors.border }]}
        onPress={() => router.push(`/messages/${item.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`Conversation with ${displayName}. ${item.last_message || 'No messages yet'}`}
      >
        <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <Text style={[styles.name, { color: colors.text }]}>{displayName}</Text>
            <Text style={[styles.time, { color: colors.secondaryText }]}>{dateStr}</Text>
          </View>
          <View style={styles.footer}>
            <Text style={[styles.lastMessage, { color: colors.secondaryText }]} numberOfLines={1}>
              {item.last_message || 'Start a conversation...'}
            </Text>
            {item.unread_count > 0 && !isStaff && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderNotificationItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={[styles.notificationCard, { backgroundColor: item.is_read ? colors.background : colors.card, borderBottomColor: colors.border }]}
      onPress={() => markAsRead(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.is_read ? 'read' : 'unread'}`}
      accessibilityHint={item.is_read ? 'This notification has been read' : 'Tap to mark this notification as read'}
    >
      <View style={[styles.iconContainer, { backgroundColor: colors.tint + '20' }]}>
        <IconSymbol name={getIconForType(item.type)} size={24} color={colors.tint} />
      </View>
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Text style={[styles.notificationTitle, { color: colors.text }]}>{item.title}</Text>
          {!item.is_read && <View style={styles.unreadDot} />}
        </View>
        <Text style={[styles.notificationBody, { color: colors.secondaryText }]}>{item.body}</Text>
        <Text style={[styles.notificationDate, { color: colors.secondaryText }]}>
          {new Date(item.created_at).toLocaleString()}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Text style={[styles.title, { color: colors.text }]}>Inbox</Text>
      
      {/* Segmented Control */}
      <View style={[styles.segmentedControl, { backgroundColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'messages' && [styles.activeSegment, { backgroundColor: colors.card }]]}
          onPress={() => setActiveTab('messages')}
        >
          <Text style={[styles.segmentText, { color: activeTab === 'messages' ? colors.text : colors.secondaryText }]}>
            Messages
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'notifications' && [styles.activeSegment, { backgroundColor: colors.card }]]}
          onPress={() => setActiveTab('notifications')}
        >
          <Text style={[styles.segmentText, { color: activeTab === 'notifications' ? colors.text : colors.secondaryText }]}>
            Notifications
          </Text>
        </TouchableOpacity>
      </View>

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        messagesLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="envelope.fill" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              Message a shop owner from any product page to start a conversation.
            </Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.list}
          />
        )
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        notificationsLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="bell.slash" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No notifications yet.</Text>
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              You have no active notifications at the moment.
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            renderItem={renderNotificationItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
          />
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: 16,
    padding: 2,
    borderRadius: 8,
    marginBottom: 16,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeSegment: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100, // padding for bottom tab bar
  },
  conversationItem: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#0D0D0D',
    fontSize: 20,
    fontWeight: '700',
  },
  itemContent: {
    flex: 1,
    justifyContent: 'center',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Notifications styles
  notificationCard: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationContent: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
    marginTop: 6,
    marginLeft: 8,
  },
  notificationBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  notificationDate: {
    fontSize: 12,
  }
});
