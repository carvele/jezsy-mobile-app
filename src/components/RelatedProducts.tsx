import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useWishlist } from '@/src/context/WishlistContext';
import { getRecentlyViewed } from '@/src/utils/recentlyViewed';
import { rankCandidates } from '@/src/utils/recommendations';

// Fetched wide, then ranked down -- ordering by relevance has to happen after
// the affinity signals are known, which Postgres has no way to express here.
const CANDIDATE_POOL = 40;
const VISIBLE_COUNT = 6;

// mainCategoryId is the *top-level* category's id (a product's own
// category_id points at its subcategory, one level down). currentSubCategoryId
// is that own category_id, used to rank exact-subcategory matches highest.
export function RelatedProducts({
  mainCategoryId,
  currentProductId,
  currentSubCategoryId = null,
}: {
  mainCategoryId: string | null;
  currentProductId: string;
  currentSubCategoryId?: string | null;
}) {
  const [products, setProducts] = useState<any[]>([]);
  const { wishlistIds } = useWishlist();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const fetchRecommendations = async () => {
      const recentIds = await getRecentlyViewed();
      const signalIds = [...new Set([...wishlistIds, ...recentIds])].filter(
        (id) => id !== currentProductId,
      );

      // Which categories the user keeps returning to. Derived on the fly from
      // signals already on the device; nothing is stored server-side for this.
      let affinityCategoryIds = new Set<string>();
      if (signalIds.length > 0) {
        const { data } = await supabase
          .from('products')
          .select('category_id')
          .in('id', signalIds);
        affinityCategoryIds = new Set(
          (data || []).map((p) => p.category_id).filter(Boolean) as string[],
        );
      }

      let subIds: string[] = [];
      if (mainCategoryId) {
        const { data: subs } = await supabase
          .from('categories')
          .select('id')
          .eq('parent_id', mainCategoryId);
        subIds = (subs || []).map((s) => s.id);
      }

      const poolCategoryIds = [...new Set([...subIds, ...affinityCategoryIds])];
      if (poolCategoryIds.length === 0) {
        if (!cancelled) setProducts([]);
        return;
      }

      const { data } = await supabase
        .from('products')
        .select('*')
        .in('category_id', poolCategoryIds)
        .neq('id', currentProductId)
        .limit(CANDIDATE_POOL);

      if (cancelled || !data) return;

      // Wishlisted and recently-viewed items are strong signals but poor
      // suggestions -- the user has already seen or saved them, and both get
      // their own strip elsewhere on this screen.
      const seen = new Set([...wishlistIds, ...recentIds]);
      const unseen = data.filter((p) => !seen.has(p.id));

      // Falling back to the full pool matters on a small catalog, where
      // excluding everything the user has touched can empty the strip.
      const candidates = unseen.length > 0 ? unseen : data;
      const signals = { currentSubCategoryId, affinityCategoryIds };
      setProducts(rankCandidates(candidates, signals, VISIBLE_COUNT));
    };

    fetchRecommendations();
    return () => {
      cancelled = true;
    };
  }, [mainCategoryId, currentProductId, currentSubCategoryId, wishlistIds]);

  if (products.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You May Also Like</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={products}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/product/${item.id}`)}
          >
            <Image
              source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
              style={styles.image}
              contentFit="cover"
            />
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.price}>
              {item.on_sale && item.sale_price ? (
                <>
                  <Text style={styles.originalPrice}>₱{item.price}</Text> ₱{item.sale_price}
                </>
              ) : (
                `₱${item.price}`
              )}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    marginBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    marginLeft: 24,
  },
  list: {
    paddingLeft: 24,
    paddingRight: 8,
  },
  card: {
    width: 140,
    marginRight: 16,
  },
  image: {
    width: 140,
    height: 180,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#f0f0f0',
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C9A96E',
  },
  originalPrice: {
    textDecorationLine: 'line-through',
    color: '#888',
    fontSize: 12,
    fontWeight: '400',
  },
});
