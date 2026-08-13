import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMessages } from '@/src/context/MessagesContext';
import { useAuth } from '@/src/context/AuthContext';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { ListRowSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { useToast } from '@/src/context/ToastContext';

export default function InboxScreen() {
  const { conversations, loading: messagesLoading, onlineUsers, isStaffOnline } = useMessages();
  const { user, profile } = useAuth();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();

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
      const nowIso = new Date().toISOString();
      const [personalRes, announcementsRes, dismissalsRes] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('announcements').select('*').or(`expires_at.is.null,expires_at.gt.${nowIso}`).order('created_at', { ascending: false }).limit(10),
        supabase.from('announcement_dismissals').select('announcement_id').eq('user_id', user.id),
      ]);

      if (personalRes.error) throw personalRes.error;
      if (announcementsRes.error) throw announcementsRes.error;
      if (dismissalsRes.error) throw dismissalsRes.error;

      const dismissedIds = new Set((dismissalsRes.data || []).map(d => d.announcement_id));
      const activeAnnouncements = (announcementsRes.data || [])
        .filter(a => !dismissedIds.has(a.id))
        .map(a => ({ ...a, kind: 'announcement' as const, is_read: true }));
      const personal = (personalRes.data || []).map(n => ({ ...n, kind: 'personal' as const }));

      const combined = [...personal, ...activeAnnouncements].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setNotifications(combined);
    } catch (err) {
      // Rendered as an empty inbox indistinguishable from having no messages.
      console.error('Error fetching notifications:', err);
      showToast('Could not load your messages. Please try again.', 'error');
    } finally {
      setNotificationsLoading(false);
    }
  }, [user, showToast]);

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

  const dismissAnnouncement = async (id: string) => {
    if (!user) return;
    setNotifications(prev => prev.filter(n => !(n.kind === 'announcement' && n.id === id)));
    try {
      await supabase.from('announcement_dismissals').insert({ user_id: user.id, announcement_id: id });
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
    // Must match is_staff_or_admin() in the DB, which returns true for staff too.
    // Omitting 'staff' here meant a staff member -- whom RLS lets see every
    // conversation -- was shown "Shop Owner" instead of the customer's ref.
    const isStaff =
      profile?.role === 'staff' || profile?.role === 'admin' || profile?.role === 'owner';
    const displayName = isStaff ? `Customer (${item.customer_id.substring(0, 6)})` : 'Boutique Support';
    const isOnline = isStaff ? !!onlineUsers[item.customer_id] : isStaffOnline;
    const isUnread = item.unread_count > 0 && !isStaff;

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
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
            <Text style={[styles.avatarText, { color: colors.onTint }]}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          {isOnline && (
            <View style={[styles.presenceDot, { backgroundColor: colors.success, borderColor: colors.background }]} />
          )}
        </View>
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <Text style={[styles.name, { color: colors.text }, isUnread && styles.nameUnread]}>{displayName}</Text>
            <Text style={[styles.time, { color: colors.secondaryText }, isUnread && { color: colors.text }]}>{dateStr}</Text>
          </View>
          <View style={styles.footer}>
            <Text
              style={[
                styles.lastMessage,
                { color: isUnread ? colors.text : colors.secondaryText },
                isUnread && styles.lastMessageUnread,
              ]}
              numberOfLines={1}
            >
              {item.last_message || 'Start a conversation...'}
            </Text>
            {isUnread && (
              <View style={[styles.badge, { backgroundColor: colors.notification }]}>
                <Text style={[styles.badgeText, { color: colors.onNotification }]}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderNotificationItem = ({ item }: { item: any }) => {
    const isAnnouncement = item.kind === 'announcement';
    return (
      <TouchableOpacity
        style={[styles.notificationCard, { backgroundColor: item.is_read ? colors.background : colors.card, borderBottomColor: colors.border }]}
        onPress={() => {
          if (!isAnnouncement) {
            markAsRead(item.id);
            if (item.reservation_id) {
              router.push(`/reservations/${item.reservation_id}`);
            } else if (item.product_id) {
              router.push(`/product/${item.product_id}`);
            } else if (item.conversation_id) {
              router.push(`/messages/${item.conversation_id}`);
            }
          }
        }}
        disabled={isAnnouncement}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.is_read ? 'read' : 'unread'}`}
        accessibilityHint={isAnnouncement ? undefined : (item.is_read ? 'This notification has been read' : 'Tap to open details')}
      >
        <View style={[styles.iconContainer, { backgroundColor: colors.tint + '20' }]}>
          <IconSymbol name={getIconForType(item.type)} size={24} color={colors.tint} />
        </View>
        <View style={styles.notificationContent}>
          <View style={styles.notificationHeader}>
            <Text style={[styles.notificationTitle, { color: colors.text }]}>{item.title}</Text>
            {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: colors.notification }]} />}
          </View>
          <Text style={[styles.notificationBody, { color: colors.secondaryText }]}>{item.body}</Text>
          <Text style={[styles.notificationDate, { color: colors.secondaryText }]}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
        </View>
        {isAnnouncement && (
          <TouchableOpacity
            style={styles.dismissButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => dismissAnnouncement(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this announcement"
          >
            <IconSymbol name="xmark" size={16} color={colors.secondaryText} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

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
          <View style={{ paddingHorizontal: Spacing.lg }}>
            <SkeletonList count={5}><ListRowSkeleton /></SkeletonList>
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
          <View style={{ paddingHorizontal: Spacing.lg }}>
            <SkeletonList count={4}><ListRowSkeleton /></SkeletonList>
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
    // 28 was the odd one out: wardrobe and profile both set their page title
    // from Type.display, so this aligns the three rather than keeping a
    // fourth size for one screen.
    ...Type.display,
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    padding: 2,
    borderRadius: Radius.sm,
    marginBottom: Spacing.lg,
  },
  segment: {
    flex: 1,
    paddingVertical: Spacing.sm,
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
    paddingHorizontal: Spacing.lg,
    paddingBottom: 120, // clears the floating tab bar at its largest bottom inset
  },
  conversationItem: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...Type.title,
  },
  presenceDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
  },
  itemContent: {
    flex: 1,
    justifyContent: 'center',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  nameUnread: {
    fontWeight: '800',
  },
  time: {
    ...Type.caption,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    ...Type.body,
    flex: 1,
    marginRight: Spacing.sm,
  },
  lastMessageUnread: {
    fontWeight: '700',
  },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: Spacing.md,
  },
  emptyTitle: {
    ...Type.title,
    marginTop: Spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Notifications styles
  notificationCard: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.lg,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
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
    marginBottom: Spacing.xs,
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
    marginTop: 6,
    marginLeft: Spacing.sm,
  },
  notificationBody: {
    ...Type.body,
    marginBottom: Spacing.sm,
  },
  notificationDate: {
    ...Type.caption,
  },
  dismissButton: {
    padding: Spacing.xs,
    alignSelf: 'flex-start',
  },
});
