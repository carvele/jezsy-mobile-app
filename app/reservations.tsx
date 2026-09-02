import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { formatPHDate } from '@/src/utils/dateFormatter';
import { supabase } from '@/src/lib/supabase';
import { ListRowSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { formatTimeLabel } from '@/src/utils/dateTime';
import { useToast } from '@/src/context/ToastContext';
import {
  STATUS_FILTERS,
  type StatusFilter,
  statusBucket,
  statusLabel,
  filterLabel,
} from '@/src/utils/reservationStatus';

// The embedded aggregate arrives as reservation_items: [{ count: n }].
type Reservation = Database['public']['Tables']['reservations']['Row'] & {
  reservation_items?: { count: number }[] | null;
};

// Lines beyond the first, which is the one the parent's product columns
// already describe. 0 for single-item reservations and for rows fetched
// without the aggregate.
const extraItemCount = (reservation: Reservation): number =>
  Math.max(0, (reservation.reservation_items?.[0]?.count ?? 1) - 1);


export default function ReservationsScreen() {
  const { session } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  const params = useLocalSearchParams<{ status?: string }>();
  const initialFilter: StatusFilter = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : 'all';
  const [activeFilter, setActiveFilter] = useState<StatusFilter>(initialFilter);

  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();

  // useFocusEffect (not useEffect) so returning to this screen after an
  // admin action elsewhere -- e.g. staff marking a reservation paid --
  // refetches instead of leaving stale status badges from the last visit.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const fetchReservations = async () => {
        if (!session?.user) return;

        try {
          // The embedded count turns "Tailored Blazer" into "Tailored Blazer
          // + 2 more": the parent's product columns only ever describe the
          // first line, so on its own a multi-item reservation reads as if it
          // held a single item.
          const { data, error } = await supabase
            .from('reservations')
            .select('*, reservation_items(count)')
            .eq('customer_id', session.user.id)
            .eq('deleted', false)
            .order('created_at', { ascending: false });

          if (error) throw error;
          if (!cancelled) setReservations(data || []);
        } catch (err) {
          // Rendered as "no reservations" indistinguishable from actually
          // having none -- including the confirm-then-pay ones now waiting on
          // a payment deadline, which is the worst screen for this to go quiet on.
          console.error('Error fetching reservations:', err);
          if (!cancelled) showToast('Unable to load reservations. Try again.', 'error');
        } finally {
          if (!cancelled) setLoading(false);
        }
      };

      fetchReservations();
      return () => {
        cancelled = true;
      };
    }, [session, showToast])
  );

  const getStatusColor = (status: string | null) => {
    switch (statusBucket(status)) {
      case 'pending': return colors.warning;
      // Money is owed: the same attention colour the deadline copy uses.
      case 'toPay': return colors.notification;
      case 'preparing': return colors.info;
      case 'ready': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
    }
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: reservations.length,
      pending: 0,
      toPay: 0,
      preparing: 0,
      ready: 0,
      completed: 0,
      cancelled: 0,
    };
    reservations.forEach((r) => {
      const bucket = statusBucket(r.status);
      if (counts[bucket] !== undefined) {
        counts[bucket] += 1;
      }
    });
    return counts;
  }, [reservations]);

  const filteredReservations = useMemo(() => {
    if (activeFilter === 'all') return reservations;
    return reservations.filter((r) => statusBucket(r.status) === activeFilter);
  }, [reservations, activeFilter]);

  const renderReservationItem = ({ item }: { item: Reservation }) => {
    const dateStr = item.date ? formatPHDate(item.date) : 'N/A';
    
    return (
      <TouchableOpacity
        style={[styles.reservationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Reservation ${item.display_id || item.id.substring(0,8)}, ${item.product_name}, status ${statusLabel(item.status)}, ${dateStr} at ${formatTimeLabel(item.appointment_time)}`}
        accessibilityHint="View reservation details"
        onPress={() => router.push(`/reservations/${item.id}` as any)}
      >
        <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.reservationId, { color: colors.secondaryText }]}>ID: {item.display_id || item.id.substring(0,8)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20', borderColor: getStatusColor(item.status) }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{statusLabel(item.status)}</Text>
          </View>
        </View>
        
        <View style={styles.cardBody}>
          <Image
            source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
            style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
            contentFit="cover"
          />
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
              {item.product_name}
              {extraItemCount(item) > 0 ? ` + ${extraItemCount(item)} more` : ''}
            </Text>
            <Text style={[styles.productDetails, { color: colors.secondaryText }]}>
              Size: {item.size || 'Standard'} • Color: {item.color || 'Default'}
            </Text>
            <Text style={[styles.appointmentDetails, { color: colors.text }]}>
              <IconSymbol name="calendar" size={14} color={colors.tint} /> {dateStr} at {formatTimeLabel(item.appointment_time)}
            </Text>
            <Text style={[styles.price, { color: colors.tint }]}>₱{(item.rental_price || 0).toFixed(2)}</Text>
          </View>
        </View>
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Reservations</Text>
        <View style={{ width: 24 }} />
      </View>

      {!loading && reservations.length > 0 && (
        <FlatList
          horizontal
          data={STATUS_FILTERS}
          keyExtractor={(f) => f}
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
          renderItem={({ item: filter }) => {
            const isActive = activeFilter === filter;
            const label = filterLabel(filter);
            const count = statusCounts[filter] ?? 0;
            return (
              <TouchableOpacity
                onPress={() => setActiveFilter(filter)}
                style={[
                  styles.filterChip,
                  { borderColor: isActive ? colors.tint : colors.border },
                  isActive && { backgroundColor: colors.tint },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Filter by ${label}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: isActive ? colors.background : colors.secondaryText },
                  ]}
                >
                  {label}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.countBadge,
                      {
                        backgroundColor: isActive ? colors.background : colors.tint,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.countBadgeText,
                        { color: isActive ? colors.tint : colors.onTint },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {loading ? (
        <View style={{ paddingHorizontal: Spacing.xl }}>
          <SkeletonList count={4}><ListRowSkeleton /></SkeletonList>
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
            <Text style={[styles.exploreButtonText, { color: colors.onTint }]}>Explore Catalog</Text>
          </TouchableOpacity>
        </View>
      ) : filteredReservations.length === 0 ? (
        <View style={styles.centerContainer}>
          <IconSymbol name="calendar.badge.exclamationmark" size={64} color={colors.border} />
          {/* Quoting the filter's own label rather than interpolating the key:
              the keys are camelCase now, so the old copy would have read
              "No toPay reservations". */}
          <Text style={[styles.emptyText, { color: colors.text }]}>
            Nothing under &ldquo;{filterLabel(activeFilter)}&rdquo;
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
            Try a different filter to see your other reservations.
          </Text>
          <TouchableOpacity
            style={[styles.exploreButton, { backgroundColor: colors.tint }]}
            onPress={() => setActiveFilter('all')}
            accessibilityRole="button"
            accessibilityLabel="Show all reservations"
          >
            <Text style={[styles.exploreButtonText, { color: colors.onTint }]}>Show All</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredReservations}
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  backButton: {
    padding: Spacing.xs,
  },
  headerTitle: {
    ...Type.subtitle,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyText: {
    ...Type.title,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    ...Type.body,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  exploreButton: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.xl,
  },
  exploreButtonText: {
    ...Type.bodyLargeStrong,
  },
  filterRow: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: Spacing.xs,
  },
  filterRowContent: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: 6,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  listContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  reservationCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reservationId: {
    ...Type.caption,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  statusText: {
    // Type.label exists for exactly this: uppercase eyebrow text, where its
    // letterSpacing stops the capitals crowding.
    ...Type.label,
    textTransform: 'uppercase',
  },
  cardBody: {
    flexDirection: 'row',
  },
  productImage: {
    width: 80,
    height: 100,
    borderRadius: Radius.sm,
  },
  productInfo: {
    flex: 1,
    marginLeft: Spacing.lg,
    justifyContent: 'center',
  },
  productName: {
    ...Type.bodyLargeStrong,
    marginBottom: Spacing.xs,
  },
  productDetails: {
    ...Type.caption,
    marginBottom: Spacing.sm,
  },
  appointmentDetails: {
    ...Type.caption,
    marginBottom: Spacing.sm,
  },
  // Not bodyLargeStrong: that is 700 and this is 800. A price is the loudest
  // thing on the card by intent, and the scale has no 16/800.
  price: {
    fontSize: 16,
    fontWeight: '800',
  },
});

