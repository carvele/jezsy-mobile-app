import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatTimeLabel } from '@/src/utils/dateTime';

type Reservation = Database['public']['Tables']['reservations']['Row'];

export default function ReservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReservation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('reservations').select('*').eq('id', id).single();
      if (error) throw error;
      setReservation(data);
    } catch (err) {
      console.error('Error fetching reservation:', err);
      setReservation(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchReservation();
  }, [fetchReservation]);

  const getStatusColor = (status: string | null) => {
    if (!status) return colors.warning;
    switch (status.toLowerCase()) {
      case 'pending': return colors.warning;
      case 'confirmed': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
      default: return colors.text;
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!reservation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Reservation not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = reservation.date
    ? new Date(reservation.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';
  const statusColor = getStatusColor(reservation.status);
  const balanceDue = (reservation.rental_price || 0) - (reservation.deposit || 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Reservation Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <Text style={[styles.displayId, { color: colors.secondaryText }]}>
            {reservation.display_id || reservation.id.substring(0, 8)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{reservation.status || 'Pending'}</Text>
          </View>
        </View>

        <View style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Image
            source={reservation.image_url ? { uri: reservation.image_url } : require('@/assets/images/partial-react-logo.png')}
            style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
            contentFit="cover"
          />
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
              {reservation.product_name}
            </Text>
            <Text style={[styles.productDetails, { color: colors.secondaryText }]}>
              Size: {reservation.size || 'Standard'} • Color: {reservation.color || 'Default'}
            </Text>
            {reservation.product_id && (
              <Link href={`/product/${reservation.product_id}`} asChild>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="View product">
                  <Text style={[styles.viewProductLink, { color: colors.tint }]}>View Product</Text>
                </TouchableOpacity>
              </Link>
            )}
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Appointment</Text>
          <View style={styles.infoRow}>
            <IconSymbol name="calendar" size={18} color={colors.tint} />
            <Text style={[styles.infoText, { color: colors.text }]}>
              {dateStr} at {formatTimeLabel(reservation.appointment_time)}
            </Text>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment</Text>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Reservation Fee</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>₱{(reservation.rental_price || 0).toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Deposit Paid</Text>
            <Text style={[styles.rowValue, { color: colors.success }]}>₱{(reservation.deposit || 0).toFixed(2)}</Text>
          </View>
          <View style={[styles.row, { marginBottom: 0 }]}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Balance Due at Pickup</Text>
            <Text style={[styles.rowValue, { color: colors.tint }]}>₱{balanceDue.toFixed(2)}</Text>
          </View>
          <View style={[styles.paymentStatusRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>Payment Status</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>{reservation.payment_status || 'Pending'}</Text>
          </View>
        </View>

        {reservation.receipt_url && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Receipt</Text>
            <Image source={{ uri: reservation.receipt_url }} style={styles.receiptImage} contentFit="cover" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 60 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  displayId: { fontSize: 13, fontWeight: '500' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  productCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  productImage: { width: 100, height: 120 },
  productInfo: { flex: 1, padding: 16, justifyContent: 'center', gap: 4 },
  productName: { fontSize: 16, fontWeight: '700' },
  productDetails: { fontSize: 13 },
  viewProductLink: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  sectionCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { fontSize: 15, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rowText: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '600' },
  paymentStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  receiptImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
});
