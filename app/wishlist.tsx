import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useWishlist } from '@/src/context/WishlistContext';
import { useToast } from '@/src/context/ToastContext';
import { getCategoryLabel } from '@/src/utils/categoryDisplay';
import { useGridCardWidth, GRID_COLUMN_GAP } from '@/src/utils/layout';
import { getWishlistPage, WishlistProduct as Product } from '@/src/services/wishlistService';

export default function WishlistScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const { toggleWishlist } = useWishlist();
  const { cardWidth, columns } = useGridCardWidth();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchWishlistProducts = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getWishlistPage(user.id, 0, 30);
      setItems(res.items);
      setOffset(res.nextOffset);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('Error fetching wishlist products:', err);
      showToast('Unable to load wishlist. Try again.', 'error');
    } finally {
      setLoading(false);
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

  const renderItem = useCallback(({ item }: { item: Product }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, width: cardWidth }]}
      onPress={() => router.push(`/product/${item.id}`)}
      activeOpacity={0.85}
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
      accessibilityLabel={`${item.name}, ₱${(item.on_sale && item.sale_price ? item.sale_price : item.price || 0).toLocaleString()}${item.on_sale ? ', on sale' : ''}`}
      accessibilityHint="Opens product details"
    >
      <View style={styles.imageWrapper}>
        <Image
          source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
          style={styles.image}
          contentFit="cover"
        />
        {/* Remove from wishlist */}
        <TouchableOpacity
          style={styles.heartBtn}
          onPress={() => {
            toggleWishlist(item.id);
            setItems((prev) => prev.filter((p) => p.id !== item.id));
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name} from wishlist`}
          accessibilityHint="Removes this item from your saved wishlist"
        >
          <IconSymbol name="heart.fill" size={20} color={colors.blush} />
        </TouchableOpacity>
        {item.on_sale && (
          <View style={[styles.saleBadge, { backgroundColor: colors.notification }]}>
            <Text style={styles.saleBadgeText}>SALE</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={[styles.category, { color: colors.secondaryText }]} numberOfLines={1}>
          {getCategoryLabel(item, 'ITEM').toUpperCase()}
        </Text>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.price, { color: item.on_sale ? colors.notification : colors.text }]}>
          ₱{(item.on_sale && item.sale_price ? item.sale_price : item.price || 0).toLocaleString()}
        </Text>
      </View>
    </TouchableOpacity>
  ), [colors, cardWidth, router, toggleWishlist]);

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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="heart" size={56} color={colors.icon} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Your wishlist is empty</Text>
          <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
            Browse the catalog and save items you love.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(tabs)/explore')}
            activeOpacity={0.85}
          >
            <Text style={[styles.browseBtnText, { color: colors.onTint }]}>Explore Catalog</Text>
          </TouchableOpacity>
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
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
  list: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  row: { marginBottom: Spacing.lg },
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
