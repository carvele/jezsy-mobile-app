import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';

type Order = Database['public']['Tables']['orders']['Row'];

export default function OrdersScreen() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  useEffect(() => {
    const fetchOrders = async () => {
      if (!session?.user) return;

      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('customer_id', session.user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setOrders(data || []);
      } catch (err) {
        console.error('Error fetching orders:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [session]);

  const getStatusColor = (status: string | null) => {
    if (!status) return colors.warning;
    switch (status.toLowerCase()) {
      case 'pending': return colors.warning;
      case 'paid': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
      default: return colors.text;
    }
  };

  const renderOrderItem = ({ item }: { item: Order }) => {
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A';

    return (
      <TouchableOpacity
        style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Order ${item.display_id}, status ${item.status || 'pending'}, placed ${dateStr}, total ${item.total_amount} pesos`}
        accessibilityHint="View order details"
        onPress={() => router.push(`/orders/${item.id}` as any)}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.orderId, { color: colors.text }]}>{item.display_id}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20', borderColor: getStatusColor(item.status) }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{item.status || 'Pending'}</Text>
          </View>
        </View>
        <Text style={[styles.orderDate, { color: colors.secondaryText }]}>{dateStr}</Text>
        <Text style={[styles.orderTotal, { color: colors.tint }]}>₱{item.total_amount.toLocaleString()}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Orders</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <IconSymbol name="bag" size={64} color={colors.border} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No orders yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
            Your purchases will appear here.
          </Text>
          <TouchableOpacity
            style={[styles.exploreButton, { backgroundColor: colors.tint }]}
            onPress={() => router.navigate('/(tabs)/explore')}
            accessibilityRole="button"
            accessibilityLabel="Explore Catalog"
            accessibilityHint="Opens the product catalog to browse items"
          >
            <Text style={styles.exploreButtonText}>Explore Catalog</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  exploreButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  exploreButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
  listContent: {
    padding: 20,
    paddingTop: 8,
  },
  orderCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  orderDate: {
    fontSize: 13,
    marginBottom: 8,
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: '800',
  },
});
