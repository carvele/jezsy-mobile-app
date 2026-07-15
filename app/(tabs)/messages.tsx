import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useMessages } from '@/src/context/MessagesContext';
import { useAuth } from '@/src/context/AuthContext';

export default function MessagesInboxScreen() {
  const { conversations, loading } = useMessages();
  const { profile } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => {
    // Determine the shop name to display for the customer,
    // or customer name to display for the shop owner.
    const isStaff = profile?.role === 'admin' || profile?.role === 'owner';
    const displayName = isStaff ? `Customer (${item.customer_id.substring(0,6)})` : 'Shop Owner';

    const dateStr = item.last_message_time 
      ? new Date(item.last_message_time).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
      : '';

    return (
      <TouchableOpacity 
        style={styles.conversationItem}
        onPress={() => router.push(`/messages/${item.id}` as any)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0)}</Text>
        </View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.time}>{dateStr}</Text>
          </View>
          <View style={styles.footer}>
            <Text style={styles.lastMessage} numberOfLines={1}>
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Messages</Text>
      {conversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No messages yet.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginHorizontal: 16,
    marginBottom: 16,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100, // padding for bottom tab bar
  },
  conversationItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
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
    color: '#888',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    color: '#666',
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
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
  }
});
