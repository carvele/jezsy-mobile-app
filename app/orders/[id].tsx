import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Image } from 'expo-image';

export default function OrderConfirmationScreen() {
  const { id } = useLocalSearchParams();
  const orderId = Array.isArray(id) ? id[0] : id;
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .single();

        if (orderError) throw orderError;
        setOrder(orderData);

        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select(`
            *,
            product:product_id(name, image_url)
          `)
          .eq('order_id', orderId);

        if (itemsError) throw itemsError;
        setItems(itemsData || []);
      } catch (err) {
        console.error('Error fetching order', err);
      } finally {
        setLoading(false);
      }
    };

    if (orderId) fetchOrder();
  }, [orderId]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.notification} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Order not found</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.tint }]} onPress={() => router.push('/(tabs)')}>
            <Text style={styles.btnText}>Return Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const shipping = order.shipping_address as any;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/(tabs)')} style={styles.backBtn}>
          <IconSymbol name="xmark" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.successIcon}>
          <IconSymbol name="checkmark.circle.fill" size={80} color="#34C759" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Order Confirmed!</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          Thank you for your purchase. Your order number is {order.display_id}.
        </Text>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Summary</Text>
          {items.map((item, idx) => (
            <View key={item.id} style={[styles.itemRow, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <Image source={{ uri: item.product?.image_url }} style={styles.itemImage} />
              <View style={styles.itemInfo}>
                <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{item.product?.name}</Text>
                <Text style={[styles.itemDetail, { color: colors.secondaryText }]}>
                  Qty: {item.quantity} {item.selected_size ? `| Size: ${item.selected_size}` : ''}
                </Text>
              </View>
              <Text style={[styles.itemPrice, { color: colors.text }]}>₱{item.unit_price.toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>Total Paid</Text>
            <Text style={[styles.totalValue, { color: colors.tint }]}>₱{order.total_amount.toLocaleString()}</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Shipping Address</Text>
          <Text style={[styles.addressText, { color: colors.text }]}>{shipping.street}</Text>
          <Text style={[styles.addressText, { color: colors.text }]}>{shipping.city}, {shipping.province} {shipping.zip}</Text>
        </View>

        <TouchableOpacity style={[styles.trackBtn, { borderColor: colors.tint }]} onPress={() => router.push('/(tabs)')}>
          <Text style={[styles.trackBtnText, { color: colors.tint }]}>Continue Shopping</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 },
  errorTitle: { fontSize: 20, fontWeight: '700' },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  btnText: { color: '#0D0D0D', fontWeight: '700' },
  content: { padding: 20, paddingBottom: 40 },
  successIcon: { alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  itemImage: { width: 48, height: 60, borderRadius: 6, backgroundColor: '#2A2A2A' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  itemDetail: { fontSize: 13 },
  itemPrice: { fontSize: 15, fontWeight: '700' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  totalLabel: { fontSize: 16, fontWeight: '700' },
  totalValue: { fontSize: 18, fontWeight: '800' },
  addressText: { fontSize: 15, lineHeight: 24 },
  trackBtn: {
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  trackBtnText: {
    fontSize: 16,
    fontWeight: '700',
  }
});
