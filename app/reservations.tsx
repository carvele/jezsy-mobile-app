import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { formatTimeLabel } from '@/src/utils/dateTime';

type Reservation = Database['public']['Tables']['reservations']['Row'];

export default function ReservationsScreen() {
  const { session } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  useEffect(() => {
    const fetchReservations = async () => {
      if (!session?.user) return;
      
      try {
        const { data, error } = await supabase
          .from('reservations')
          .select('*')
          .eq('customer_id', session.user.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setReservations(data || []);
      } catch (err) {
        console.error('Error fetching reservations:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReservations();
  }, [session]);

  const getStatusColor = (status: string | null) => {
    if (!status) return '#FFB703';
    switch (status.toLowerCase()) {
      case 'pending': return '#FFB703';
      case 'confirmed': return '#83C5BE';
      case 'completed': return '#06D6A0';
      case 'cancelled': return '#EF476F';
      default: return colors.text;
    }
  };

  const renderReservationItem = ({ item }: { item: Reservation }) => {
    const dateStr = item.date ? new Date(item.date).toLocaleDateString() : 'N/A';
    
    return (
      <View
        style={[styles.reservationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessible={true}
        accessibilityRole="summary"
        accessibilityLabel={`Reservation ${item.display_id || item.id.substring(0,8)}, ${item.product_name}, status ${item.status || 'Pending'}, ${dateStr} at ${formatTimeLabel(item.appointment_time)}`}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.reservationId, { color: colors.secondaryText }]}>ID: {item.display_id || item.id.substring(0,8)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20', borderColor: getStatusColor(item.status) }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{item.status || 'Pending'}</Text>
          </View>
        </View>
        
        <View style={styles.cardBody}>
          <Image 
            source={{ uri: item.image_url || 'https://via.placeholder.com/100' }}
            style={styles.productImage}
            contentFit="cover"
          />
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>{item.product_name}</Text>
            <Text style={[styles.productDetails, { color: colors.secondaryText }]}>
              Size: {item.size || 'Standard'} • Color: {item.color || 'Default'}
            </Text>
            <Text style={[styles.appointmentDetails, { color: colors.text }]}>
              <IconSymbol name="calendar" size={14} color={colors.tint} /> {dateStr} at {formatTimeLabel(item.appointment_time)}
            </Text>
            <Text style={[styles.price, { color: colors.tint }]}>₱{(item.rental_price || 0).toFixed(2)}</Text>
          </View>
        </View>
      </View>
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Reservations</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : reservations.length === 0 ? (
        <View style={styles.centerContainer}>
          <IconSymbol name="calendar.badge.exclamationmark" size={64} color={colors.border} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No reservations yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
            Your upcoming fitting appointments will appear here.
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
          data={reservations}
          keyExtractor={(item) => item.id}
          renderItem={renderReservationItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
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
  },
  reservationCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  reservationId: {
    fontSize: 12,
    fontWeight: '500',
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
  cardBody: {
    flexDirection: 'row',
  },
  productImage: {
    width: 80,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
  },
  productInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  productDetails: {
    fontSize: 13,
    marginBottom: 8,
  },
  appointmentDetails: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
  },
});

