import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useRouter } from 'expo-router';

export default function NotificationsScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { user } = useAuth();
  const router = useRouter();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
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
      setLoading(false);
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

  const renderNotification = ({ item }: { item: any }) => (
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
      <View style={styles.content}>
        <View style={styles.cardHeader}>
          <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
          {!item.is_read && <View style={styles.unreadDot} />}
        </View>
        <Text style={[styles.body, { color: colors.secondaryText }]}>{item.body}</Text>
        <Text style={[styles.date, { color: colors.secondaryText }]}>
          {new Date(item.created_at).toLocaleString()}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="bell.slash" size={48} color={colors.border} />
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderNotification}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150,150,150,0.1)',
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 16 },
  list: { paddingBottom: 24 },
  notificationCard: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  title: {
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
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  date: {
    fontSize: 12,
  }
});
