import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useWishlist } from '@/src/context/WishlistContext';
import { Database } from '@/src/types/database.types';
import { CATEGORY_SELECT, getCategoryLabel, WithCategoryEmbed } from '@/src/utils/categoryDisplay';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function WishlistScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();
  const { wishlistIds, toggleWishlist } = useWishlist();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWishlistProducts = useCallback(async () => {
    if (!user?.id || wishlistIds.size === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ids = Array.from(wishlistIds);
      const { data, error } = await supabase
        .from('products')
        .select(`*, ${CATEGORY_SELECT}`)
        .in('id', ids)
        .eq('deleted', false);
      if (!error && data) setItems(data);
    } catch (err) {
      console.error('Error fetching wishlist products:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, wishlistIds]);

  useEffect(() => {
    fetchWishlistProducts();
  }, [fetchWishlistProducts]);

  const renderItem = useCallback(({ item }: { item: Product }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => router.push(`/product/${item.id}`)}
      activeOpacity={0.85}
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
          onPress={() => toggleWishlist(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <IconSymbol name="heart.fill" size={20} color="#E05C5C" />
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
          ₱{(item.sale_price || item.price || 0).toLocaleString()}
        </Text>
      </View>
    </TouchableOpacity>
  ), [colors, router, toggleWishlist]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Wishlist</Text>
        <View style={{ width: 38 }} />
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
            Save items you love while browsing the catalog.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(tabs)/explore')}
            activeOpacity={0.85}
          >
            <Text style={styles.browseBtnText}>Browse Catalog</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews={true}
          showsVerticalScrollIndicator={false}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  browseBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  browseBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 15 },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  row: { justifyContent: 'space-between', marginBottom: 16 },
  countText: { fontSize: 13, marginBottom: 12, marginTop: 4 },
  card: {
    width: CARD_WIDTH,
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
  saleBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  info: { padding: 10, gap: 2 },
  category: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  name: { fontSize: 14, fontWeight: '600' },
  price: { fontSize: 14, fontWeight: '700' },
});
