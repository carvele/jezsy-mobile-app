import React, { useCallback, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { ReviewModal } from '@/src/components/ReviewModal';
import { getMyUnratedItems, UnratedItem } from '@/src/services/reservationService';

// A distinct destination, not a reservations.tsx filter -- it groups by
// product across all Completed reservations rather than by reservation, so
// it doesn't fit that screen's one-row-per-reservation list.
export default function ToRateScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();

  const [items, setItems] = useState<UnratedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewProductId, setReviewProductId] = useState<string | null>(null);

  const fetchUnrated = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const data = await getMyUnratedItems(session.user.id);
      setItems(data);
    } catch (err) {
      console.error('Error fetching items to rate:', err);
      showToast('Unable to load items to rate. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [session?.user, showToast]);

  useFocusEffect(
    useCallback(() => {
      fetchUnrated();
    }, [fetchUnrated])
  );

  const renderItem = ({ item }: { item: UnratedItem }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.cardBody}
        accessibilityRole="button"
        accessibilityLabel={`${item.productName}, from reservation ${item.displayId ?? ''}`}
        accessibilityHint="View reservation details"
        onPress={() => router.push(`/reservations/${item.reservationId}` as any)}
      >
        <Image
          source={item.imageUrl ? { uri: item.imageUrl } : require('@/assets/images/partial-react-logo.png')}
          style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
          contentFit="cover"
        />
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
            {item.productName}
          </Text>
          <Text style={[styles.productDetails, { color: colors.secondaryText }]}>
            Size: {item.size || 'Standard'} • Color: {item.color || 'Default'}
          </Text>
          {item.displayId && (
            <Text style={[styles.reservationId, { color: colors.secondaryText }]}>
              From {item.displayId}
            </Text>
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.rateBtn, { borderColor: colors.tint }]}
        onPress={() => setReviewProductId(item.productId)}
        accessibilityRole="button"
        accessibilityLabel={`Rate ${item.productName}`}
      >
        <IconSymbol name="star.fill" size={14} color={colors.tint} />
        <Text style={[styles.rateBtnText, { color: colors.tint }]}>Rate this item</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>To Rate</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="star" size={64} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing to rate</Text>
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            Items from completed reservations will show up here once they&apos;re ready to review.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.reservationItemId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      <ReviewModal
        visible={reviewProductId !== null}
        productId={reviewProductId ?? ''}
        onClose={() => setReviewProductId(null)}
        onSuccess={() => {
          setReviewProductId(null);
          fetchUnrated();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButton: { padding: Spacing.xs },
  headerTitle: { ...Type.subtitle },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  emptyTitle: { ...Type.bodyLargeStrong, marginTop: Spacing.lg },
  emptyText: { ...Type.body, textAlign: 'center', marginTop: Spacing.sm },
  listContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cardBody: {
    flexDirection: 'row',
  },
  productImage: {
    width: 64,
    height: 80,
    borderRadius: Radius.sm,
  },
  productInfo: {
    flex: 1,
    marginLeft: Spacing.lg,
    justifyContent: 'center',
  },
  productName: { ...Type.bodyLargeStrong },
  productDetails: { ...Type.caption, marginTop: 2 },
  reservationId: { ...Type.caption, marginTop: 4 },
  rateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.md,
  },
  rateBtnText: { ...Type.bodyStrong },
});
