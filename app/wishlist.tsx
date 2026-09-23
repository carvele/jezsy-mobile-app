import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { useGridCardWidth, GRID_COLUMN_GAP, GRID_GUTTER } from '@/src/utils/layout';
import { ProductCard } from '@/src/components/ProductCard';
import { TwoColumnRow } from '@/src/components/ui/TwoColumnRow';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { ProductCardSkeleton } from '@/src/components/Skeleton';
import { ErrorRetryState } from '@/src/components/ErrorRetryState';
import { getWishlistPage, WishlistProduct as Product } from '@/src/services/wishlistService';

export default function WishlistScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const { columns } = useGridCardWidth();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchWishlistProducts = useCallback(async (isRefresh = false) => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await getWishlistPage(user.id, 0, 30);
      setItems(res.items);
      setOffset(res.nextOffset);
      setHasMore(res.hasMore);
      setLoadError(null);
    } catch (err) {
      console.error('Error fetching wishlist products:', err);
      setItems((prev) => {
        if (prev.length === 0) {
          setLoadError('Unable to load your wishlist. Please check your connection and try again.');
        } else {
          showToast('Unable to refresh wishlist.', 'error');
        }
        return prev;
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setIsRetrying(false);
    }
  }, [user?.id, showToast]);

  const loadMoreWishlist = useCallback(async () => {
    if (!user?.id || loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await getWishlistPage(user.id, offset, 30);
      setItems((prev) => {
        const existing = new Set(prev.map((p) => p.id));
        const novel = res.items.filter((p) => !existing.has(p.id));
        return [...prev, ...novel];
      });
      setOffset(res.nextOffset);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('Error loading more wishlist products:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [user?.id, offset, loadingMore, hasMore, loading]);

  useEffect(() => {
    fetchWishlistProducts();
  }, [fetchWishlistProducts]);

  const handleRetry = useCallback(() => {
    setIsRetrying(true);
    setLoading(true);
    setLoadError(null);
    fetchWishlistProducts(false);
  }, [fetchWishlistProducts]);

  const renderItem = useCallback(({ item }: { item: Product }) => (
    <ProductCard product={item} variant="grid" />
  ), []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Wishlist</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !refreshing && items.length === 0 ? (
        <View style={{ paddingHorizontal: GRID_GUTTER, paddingTop: Spacing.md }}>
          {Array.from({ length: 3 }).map((_, rowIndex) => (
            <TwoColumnRow key={`wishlist-skel-${rowIndex}`}>
              <ProductCardSkeleton layout="fill" />
              <ProductCardSkeleton layout="fill" />
            </TwoColumnRow>
          ))}
        </View>
      ) : loadError && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }}>
          <ErrorRetryState
            title="Unable to load wishlist"
            message={loadError}
            onRetry={handleRetry}
            isRetrying={isRetrying}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }}>
          <BrandEmptyState
            icon="heart"
            title="Your wishlist is empty"
            message="Browse the catalog and save items you love."
            actionLabel="Explore Catalog"
            onAction={() => router.push('/(tabs)/explore')}
          />
        </View>
      ) : (
        <FlatList
          key={columns}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          contentContainerStyle={styles.list}
          columnWrapperStyle={[styles.row, { gap: GRID_COLUMN_GAP, justifyContent: 'flex-start' }]}
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews={true}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMoreWishlist}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchWishlistProducts(true)}
              tintColor={colors.tint}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.md }} />
            ) : null
          }
          ListHeaderComponent={
            <Text style={[styles.countText, { color: colors.secondaryText }]}>
              {items.length} {items.length === 1 ? 'item' : 'items'} saved
            </Text>
          }
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
    paddingHorizontal: GRID_GUTTER,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm, marginLeft: -Spacing.sm },
  headerTitle: { ...Type.subtitle },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.md },
  emptyTitle: { ...Type.title, marginTop: Spacing.sm },
  emptySubtitle: { ...Type.body, textAlign: 'center' },
  browseBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  browseBtnText: { fontWeight: '800', fontSize: 15 },
  list: { paddingHorizontal: GRID_GUTTER, paddingBottom: 100 },
  row: { marginBottom: 0 },
  countText: { ...Type.caption, marginBottom: Spacing.md, marginTop: Spacing.xs },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  imageWrapper: { position: 'relative', aspectRatio: 3 / 4 },
  image: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 6,
  },
  saleBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  saleBadgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  info: { padding: 10, gap: 2 },
  category: { ...Type.label },
  name: { fontSize: 14, fontWeight: '600' },
  price: { fontSize: 14, fontWeight: '700' },
});
