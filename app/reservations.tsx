import React, { useCallback, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { formatPHDate, formatTimeLabel } from '@/src/utils/dateTime';
import { ListRowSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import {
  STATUS_FILTERS,
  type StatusFilter,
  statusBucket,
  statusLabel,
  filterLabel,
  formatPaymentDeadline,
  getReservationCardActions,
} from '@/src/utils/reservationStatus';
import {
  getMyReservationsPage,
  getMyReservationStatusCounts,
  CustomerReservation as Reservation,
} from '@/src/services/reservationService';
import { getReturnRequestWindowDays } from '@/src/services/settingsService';
import { useMessages } from '@/src/context/MessagesContext';

// Lines beyond the first, which is the one the parent's product columns
// already describe. 0 for single-item reservations and for rows fetched
// without the aggregate.
const extraItemCount = (reservation: Reservation): number =>
  Math.max(0, (reservation.reservation_items?.[0]?.count ?? 1) - 1);


export default function ReservationsScreen() {
  const { session } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({
    all: 0,
    toPay: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    returnRefund: 0,
    cancelled: 0,
  });
  const [returnWindowDays, setReturnWindowDays] = useState(7);

  const params = useLocalSearchParams<{ status?: string }>();
  const initialFilter: StatusFilter = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : 'all';
  const [activeFilter, setActiveFilter] = useState<StatusFilter>(initialFilter);

  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const { getOrCreateConversation } = useMessages();

  const fetchInitialReservations = useCallback(async (filterToFetch: StatusFilter) => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const [res, counts, windowDays] = await Promise.all([
        getMyReservationsPage(session.user.id, 0, filterToFetch, 20),
        getMyReservationStatusCounts(session.user.id),
        getReturnRequestWindowDays(),
      ]);
      setReservations(res.items);
      setOffset(res.nextOffset);
      setHasMore(res.hasMore);
      setStatusCounts(counts);
      setReturnWindowDays(windowDays);
    } catch (err) {
      console.error('Error fetching reservations:', err);
      showToast('Unable to load reservations. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [session?.user, showToast]);

  useFocusEffect(
    useCallback(() => {
      fetchInitialReservations(activeFilter);
    }, [fetchInitialReservations, activeFilter])
  );

  const handleFilterChange = useCallback((filter: StatusFilter) => {
    setActiveFilter(filter);
    fetchInitialReservations(filter);
  }, [fetchInitialReservations]);

  const loadMoreReservations = useCallback(async () => {
    if (!session?.user || loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await getMyReservationsPage(session.user.id, offset, activeFilter, 20);
      setReservations((prev) => {
        const existing = new Set(prev.map((r) => r.id));
        const novel = res.items.filter((r) => !existing.has(r.id));
        return [...prev, ...novel];
      });
      setOffset(res.nextOffset);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('Error loading more reservations:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [session?.user, offset, activeFilter, loadingMore, hasMore, loading]);

  const getStatusColor = (status: string | null) => {
    switch (statusBucket(status)) {
      case 'toPay': return colors.notification;
      case 'preparing': return colors.info;
      case 'ready': return colors.info;
      case 'completed': return colors.success;
      case 'cancelled': return colors.error;
    }
  };

  const handleReturnRefund = useCallback(async (item: Reservation) => {
    try {
      const conv = await getOrCreateConversation();
      if (!conv) {
        showToast('Unable to open support chat right now. Please try again.', 'error');
        return;
      }
      const refId = item.display_id || item.id.substring(0, 8);
      router.push({
        pathname: '/messages/[conversationId]',
        params: {
          conversationId: conv.id,
          ctxType: 'reservation',
          ctxRef: item.id,
          ctxLabel: `Reservation ${refId}${item.product_name ? ` - ${item.product_name}` : ''}`,
          prefill: `I would like to request a return/refund for reservation #${refId}.`,
        },
      } as any);
    } catch (err) {
      console.error('Error opening return/refund chat:', err);
      showToast('Could not start return request chat.', 'error');
    }
  }, [getOrCreateConversation, router, showToast]);

  const renderReservationItem = ({ item }: { item: Reservation }) => {
    const dateStr = item.date ? formatPHDate(item.date) : 'N/A';
    // Only the payment window has a deadline worth flagging -- once it's
    // paid or past that stage, payment_due_at is a stale leftover value.
    const deadline = statusBucket(item.status) === 'toPay'
      ? formatPaymentDeadline(item.payment_due_at)
      : null;
    const hasRefundPending =
      statusBucket(item.status) === 'cancelled' &&
      item.payment_status?.toLowerCase() === 'refund required';

    const cardActions = getReservationCardActions(item, { windowDays: returnWindowDays });

    return (
      <TouchableOpacity
        style={[styles.reservationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Reservation ${item.display_id || item.id.substring(0,8)}, ${item.product_name}, status ${statusLabel(item.status)}${hasRefundPending ? ', refund in progress' : ''}${deadline ? `, ${deadline.label} to pay` : ''}, ${dateStr} at ${formatTimeLabel(item.appointment_time)}`}
        accessibilityHint="View reservation details"
        onPress={() => router.push(`/reservations/${item.id}` as any)}
      >
        <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.reservationId, { color: colors.secondaryText }]}>ID: {item.display_id || item.id.substring(0,8)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            {deadline && (
              <View style={[styles.deadlineBadge, { borderColor: deadline.urgent ? colors.error : colors.warning }]}>
                <Text style={[styles.deadlineText, { color: deadline.urgent ? colors.error : colors.warning }]}>
                  {deadline.label}
                </Text>
              </View>
            )}
            {hasRefundPending && (
              <View style={[styles.deadlineBadge, { borderColor: colors.error }]}>
                <Text style={[styles.deadlineText, { color: colors.error }]}>REFUND IN PROGRESS</Text>
              </View>
            )}
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20', borderColor: getStatusColor(item.status) }]}>
              <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{statusLabel(item.status)}</Text>
            </View>
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

        {cardActions.length > 0 && (
          <View style={[styles.cardActionsRow, { borderTopColor: colors.border }]}>
            {cardActions.map((action) => {
              if (action === 'toPay') {
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.cardActionBtn, styles.cardActionBtnPrimary, { backgroundColor: colors.tint }]}
                    onPress={() => router.push(`/reservations/${item.id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Pay for reservation"
                  >
                    <Text style={[styles.cardActionBtnText, { color: colors.onTint }]}>To Pay</Text>
                  </TouchableOpacity>
                );
              }
              if (action === 'returnRefund') {
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.cardActionBtn, styles.cardActionBtnOutline, { borderColor: colors.border }]}
                    onPress={() => handleReturnRefund(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Request return or refund"
                  >
                    <Text style={[styles.cardActionBtnText, { color: colors.text }]}>Return / Refund</Text>
                  </TouchableOpacity>
                );
              }
              if (action === 'rate') {
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.cardActionBtn, styles.cardActionBtnOutline, { borderColor: colors.tint }]}
                    onPress={() => router.push('/reservations/to-rate' as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Rate reservation item"
                  >
                    <IconSymbol name="star.fill" size={13} color={colors.tint} />
                    <Text style={[styles.cardActionBtnText, { color: colors.tint }]}>Rate</Text>
                  </TouchableOpacity>
                );
              }
              if (action === 'buyAgain') {
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.cardActionBtn, styles.cardActionBtnOutline, { borderColor: colors.tint }]}
                    onPress={() => {
                      if (item.product_id) {
                        router.push(`/product/${item.product_id}` as any);
                      } else {
                        router.push('/explore' as any);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Buy or reserve again"
                  >
                    <Text style={[styles.cardActionBtnText, { color: colors.tint }]}>Buy Again</Text>
                  </TouchableOpacity>
                );
              }
              if (action === 'viewRefund') {
                return (
                  <TouchableOpacity
                    key={action}
                    style={[styles.cardActionBtn, styles.cardActionBtnOutline, { borderColor: colors.error }]}
                    onPress={() => router.push(`/reservations/${item.id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel="View refund details"
                  >
                    <Text style={[styles.cardActionBtnText, { color: colors.error }]}>View Refund</Text>
                  </TouchableOpacity>
                );
              }
              return null;
            })}
          </View>
        )}
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

      {/* Keyed on the unfiltered total, not the current page: a filter with
          zero matches must keep showing the row, or switching back to "all"
          becomes impossible once a tab comes up empty. */}
      {!loading && statusCounts.all > 0 && (
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
                onPress={() => handleFilterChange(filter)}
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
                {count > 0 && ['toPay', 'preparing', 'ready', 'returnRefund'].includes(filter) && (
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
      ) : reservations.length === 0 && activeFilter !== 'all' ? (
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
            onPress={() => handleFilterChange('all')}
            accessibilityRole="button"
            accessibilityLabel="Show all reservations"
          >
            <Text style={[styles.exploreButtonText, { color: colors.onTint }]}>Show All</Text>
          </TouchableOpacity>
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
      ) : (
        <FlatList
          data={reservations}
          keyExtractor={(item) => item.id}
          renderItem={renderReservationItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMoreReservations}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.md }} />
            ) : null
          }
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
    // react-native-web's FlatList content container can default to
    // flexWrap: 'wrap' even with horizontal set, unlike ScrollView --
    // without this override, chips silently stack into a single vertical
    // column at narrow (mobile) viewport widths instead of scrolling
    // sideways in one row.
    flexWrap: 'nowrap',
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
  deadlineBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  deadlineText: {
    ...Type.label,
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
  price: {
    fontSize: 16,
    fontWeight: '800',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    minHeight: 32,
  },
  cardActionBtnPrimary: {
    paddingHorizontal: Spacing.lg,
  },
  cardActionBtnOutline: {
    borderWidth: 1,
  },
  cardActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

