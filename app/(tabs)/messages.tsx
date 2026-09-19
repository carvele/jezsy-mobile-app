import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMessages } from '@/src/context/MessagesContext';
import { useAuth } from '@/src/context/AuthContext';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { announcementService } from '@/src/services';
import { formatPHDate } from '@/src/utils/dateTime';
import { ListRowSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { ErrorRetryState } from '@/src/components/ErrorRetryState';
import { useToast } from '@/src/context/ToastContext';
import { getNotificationsPage, NotificationItem } from '@/src/services/notificationService';
import { useNotifications } from '@/src/context/NotificationContext';
import { resolveNotificationRoute } from '@/src/utils/notificationRouting';

import { useTourCoachmark, TourCoachmarkBanner } from '@/src/features/systemTour/TourCoachmark';
import { useSharedBottomInset } from '@/src/hooks/useFloatingTabBarMetrics';

export default function InboxScreen() {
  const bottomInset = useSharedBottomInset();
  const { conversations, loading: messagesLoading, error: messagesError, refreshConversations, onlineUsers, isStaffOnline, getOrCreateConversation } = useMessages();
  const { user, profile } = useAuth();
  const { unreadNonChatCount, markAsRead: markNotifReadInContext, markAllAsRead: markAllNotifsReadInContext } = useNotifications();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const tourCoachmark = useTourCoachmark('messages');

  const isStaff = profile?.role === 'staff' || profile?.role === 'owner';
  const shopUnreadCount = conversations.reduce(
    (sum, c) => sum + (isStaff ? (c.unread_staff || 0) : (c.unread_customer || 0)),
    0
  );

  const [activeTab, setActiveTab] = useState<'shop' | 'notifications'>('shop');
  const [startingShopChat, setStartingShopChat] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const handleStartShopChat = useCallback(async () => {
    if (isStaff) return;
    if (!user) {
      showToast('Please sign in to message boutique staff.', 'info');
      return;
    }
    if (startingShopChat) return;
    setStartingShopChat(true);
    try {
      const conv = await getOrCreateConversation();
      if (conv) {
        router.push(`/messages/${conv.id}` as any);
      } else {
        showToast('Unable to open support chat right now. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Error starting boutique conversation:', err);
      showToast('Unable to connect with boutique staff.', 'error');
    } finally {
      setStartingShopChat(false);
    }
  }, [isStaff, user, startingShopChat, getOrCreateConversation, router, showToast]);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notifOffset, setNotifOffset] = useState(0);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setNotificationsLoading(false);
      setNotificationsError(null);
      return;
    }
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const res = await getNotificationsPage(user.id, 0, 30);
      setNotifications(res.items);
      setNotifOffset(res.nextOffset);
      setHasMoreNotifications(res.hasMore);
    } catch (err: any) {
      console.error('Error fetching notifications:', err);
      setNotificationsError(err?.message || 'Could not load notifications.');
      showToast('Could not load your notifications. Please try again.', 'error');
    } finally {
      setNotificationsLoading(false);
    }
  }, [user, showToast]);

  const loadMoreNotifications = useCallback(async () => {
    if (!user || loadingMoreNotifications || !hasMoreNotifications) return;
    setLoadingMoreNotifications(true);
    try {
      const res = await getNotificationsPage(user.id, notifOffset, 30);
      setNotifications((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const novel = res.items.filter((n) => !existing.has(n.id));
        return [...prev, ...novel];
      });
      setNotifOffset(res.nextOffset);
      setHasMoreNotifications(res.hasMore);
    } catch (err) {
      console.error('Error loading more notifications:', err);
    } finally {
      setLoadingMoreNotifications(false);
    }
  }, [user, notifOffset, loadingMoreNotifications, hasMoreNotifications]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    const previous = notifications.find(n => n.id === id);
    try {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      await markNotifReadInContext(id);
    } catch (e) {
      console.error('Failed to persist notification read state:', e);
      if (previous) {
        setNotifications(prev => prev.map(n => n.id === id ? previous : n));
      } else {
        fetchNotifications();
      }
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      await markAllNotifsReadInContext();
      showToast('All notifications marked as read', 'success');
    } catch (e) {
      console.error('Error marking all as read:', e);
      showToast('Could not mark all as read.', 'error');
      fetchNotifications();
    } finally {
      setMarkingAllRead(false);
    }
  };

  const dismissAnnouncement = async (id: string) => {
    if (!user) return;
    setNotifications(prev => prev.filter(n => !(n.kind === 'announcement' && n.id === id)));
    try {
      const result = await announcementService.dismiss({ userId: user.id, announcementId: id });
      if (!result.ok) console.error(result.error);
    } catch (e) {
      console.error(e);
    }
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'reservation':
      case 'order':
        return 'calendar';
      case 'product':
      case 'promo':
        return 'tag.fill';
      case 'review':
        return 'star.fill';
      case 'conversation':
      case 'direct_chat':
        return 'bubble.left.and.bubble.right';
      case 'system':
      case 'announcement':
        return 'info.circle.fill';
      default:
        return 'bell.fill';
    }
  };

  const renderMessageItem = ({ item }: { item: any }) => {
    // Must match is_staff_or_admin() in the DB, which returns true for staff too.
    // Omitting 'staff' here meant a staff member -- whom RLS lets see every
    // conversation -- was shown "Shop Owner" instead of the customer's ref.
    const isStaff =
      profile?.role === 'staff' || profile?.role === 'owner';
    const displayName = isStaff ? `Customer (${item.customer_id?.substring(0, 6) ?? 'Unknown'})` : 'Boutique Support';
    const isOnline = isStaff ? !!onlineUsers[item.customer_id] : isStaffOnline;
    const isUnread = item.unread_customer > 0 && !isStaff;

    const dateStr = item.last_message_time
      ? formatPHDate(item.last_message_time, {
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
                <Text style={[styles.badgeText, { color: colors.onNotification }]}>{item.unread_customer}</Text>
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
            const route = resolveNotificationRoute(item.data);
            if (route) {
              router.push(route as any);
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

  if (!user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Inbox</Text>
        </View>
        <View style={{ flex: 1, padding: Spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: colors.tint + '15',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: Spacing.xl,
          }}>
            <IconSymbol name="bubble.left.and.bubble.right" size={38} color={colors.tint} />
          </View>
          <Text style={[Type.title, { color: colors.text, textAlign: 'center', marginBottom: Spacing.sm }]}>
            Boutique & Stylist Messages
          </Text>
          <Text style={[Type.body, { color: colors.secondaryText, textAlign: 'center', marginBottom: Spacing.xxl, lineHeight: 22, maxWidth: 320 }]}>
            Sign in to chat directly with boutique staff about sizing, reservations, custom alterations, and outfit inquiries.
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.tint,
              paddingVertical: 14,
              paddingHorizontal: Spacing.xxl,
              borderRadius: Radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              maxWidth: 280,
            }}
            onPress={() => router.push('/(auth)/welcome')}
            accessibilityRole="button"
            accessibilityLabel="Sign in or register to view inbox"
          >
            <Text style={{ color: colors.onTint, fontWeight: '600', fontSize: 16 }}>
              Sign In / Register
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Inbox</Text>
        {activeTab === 'notifications' && notifications.length > 0 && (
          <TouchableOpacity
            style={[styles.headerSupportButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleMarkAllAsRead}
            disabled={markingAllRead}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
          >
            {markingAllRead ? (
              <ActivityIndicator size="small" color={colors.tint} />
            ) : (
              <>
                <IconSymbol name="checkmark.circle" size={13} color={colors.tint} style={{ marginRight: 6 }} />
                <Text style={[styles.headerSupportText, { color: colors.tint }]}>Mark all read</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
      

      {/* Segmented Control */}
      <View style={[styles.segmentedControl, { backgroundColor: colors.border }]} accessibilityRole="tablist">
        <TouchableOpacity
          style={[styles.segment, activeTab === 'shop' && [styles.activeSegment, { backgroundColor: colors.card }]]}
          onPress={() => setActiveTab('shop')}
          accessibilityRole="tab"
          accessibilityLabel="Shop tab"
          accessibilityState={{ selected: activeTab === 'shop' }}
        >
          <View style={styles.segmentContent}>
            <Text style={[styles.segmentText, { color: activeTab === 'shop' ? colors.text : colors.secondaryText }]}>
              Shop
            </Text>
            {shopUnreadCount > 0 && (
              <View style={[styles.tabBadge, { backgroundColor: colors.notification }]}>
                <Text style={styles.tabBadgeText}>{shopUnreadCount > 99 ? '99+' : shopUnreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'notifications' && [styles.activeSegment, { backgroundColor: colors.card }]]}
          onPress={() => setActiveTab('notifications')}
          accessibilityRole="tab"
          accessibilityLabel="Notifications tab"
          accessibilityState={{ selected: activeTab === 'notifications' }}
        >
          <View style={styles.segmentContent}>
            <Text style={[styles.segmentText, { color: activeTab === 'notifications' ? colors.text : colors.secondaryText }]}>
              Notifications
            </Text>
            {unreadNonChatCount > 0 && (
              <View style={[styles.tabBadge, { backgroundColor: colors.notification }]}>
                <Text style={styles.tabBadgeText}>{unreadNonChatCount > 99 ? '99+' : unreadNonChatCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Shop Tab */}
      {activeTab === 'shop' && (
        messagesLoading ? (
          <View style={{ paddingHorizontal: Spacing.lg }}>
            <SkeletonList count={5}><ListRowSkeleton /></SkeletonList>
          </View>
        ) : messagesError && conversations.length === 0 ? (
          <ErrorRetryState
            title="Unable to load messages"
            message={messagesError}
            onRetry={refreshConversations}
          />
        ) : conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            {isStaff ? (
              <>
                <IconSymbol name="envelope.fill" size={48} color={colors.border} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No customer messages yet</Text>
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  Customer inquiries and fitting messages will appear here.
                </Text>
              </>
            ) : (
              <>
                <View style={[styles.emptyIconBadge, { backgroundColor: colors.tint + '18' }]}>
                  <IconSymbol name="bubble.left.and.bubble.right" size={32} color={colors.tint} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Connect with Boutique Staff</Text>
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  Need help with sizing, fitting, reservations, styling, or your order? Our boutique team is here to assist you.
                </Text>
                <TouchableOpacity
                  style={[styles.primaryEmptyButton, { backgroundColor: colors.tint }]}
                  onPress={handleStartShopChat}
                  disabled={startingShopChat}
                  accessibilityRole="button"
                  accessibilityLabel="Message Boutique Staff"
                >
                  {startingShopChat ? (
                    <ActivityIndicator size="small" color={colors.onTint} />
                  ) : (
                    <>
                      <IconSymbol name="bubble.left.and.bubble.right" size={16} color={colors.onTint} style={{ marginRight: Spacing.sm }} />
                      <Text style={[styles.primaryEmptyButtonText, { color: colors.onTint }]}>
                        Message Boutique Staff
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryEmptyButton, { borderColor: colors.border }]}
                  onPress={() => router.push('/explore' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Browse Collection"
                >
                  <IconSymbol name="bag.fill" size={15} color={colors.text} style={{ marginRight: Spacing.sm }} />
                  <Text style={[styles.secondaryEmptyButtonText, { color: colors.text }]}>
                    Browse Collection
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderMessageItem}
            contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
          />
        )
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        notificationsLoading ? (
          <View style={{ paddingHorizontal: Spacing.lg }}>
            <SkeletonList count={4}><ListRowSkeleton /></SkeletonList>
          </View>
        ) : notificationsError && notifications.length === 0 ? (
          <ErrorRetryState
            title="Unable to load notifications"
            message={notificationsError}
            onRetry={fetchNotifications}
          />
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
            contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
            onEndReached={loadMoreNotifications}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMoreNotifications ? (
                <View style={{ paddingVertical: Spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.tint} />
                </View>
              ) : null
            }
          />
        )
      )}

      {tourCoachmark.step && (
        <TourCoachmarkBanner
          title={tourCoachmark.step.title}
          description={tourCoachmark.step.description}
          stepNumber={tourCoachmark.stepNumber}
          totalSteps={tourCoachmark.totalSteps}
          onNext={tourCoachmark.step.completion.type === 'next' ? tourCoachmark.advance : undefined}
          onDismiss={tourCoachmark.dismiss}
        />
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  headerSupportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  headerSupportText: {
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    ...Type.display,
    marginBottom: 0,
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
    elevation: 2,
    ...Platform.select({
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.1)' },
    }),
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  segmentContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  list: {
    paddingHorizontal: Spacing.lg,
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
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xs,
  },
  emptyIconBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  primaryEmptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: Radius.md,
    width: '100%',
    maxWidth: 280,
    marginTop: Spacing.xs,
  },
  primaryEmptyButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryEmptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    width: '100%',
    maxWidth: 280,
  },
  secondaryEmptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
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
