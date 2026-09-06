import type { Database } from '@/src/types/database.types';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { useWishlist } from '@/src/context/WishlistContext';
import { useAuth } from '@/src/context/AuthContext';
import { getRecentlyViewed } from '@/src/utils/recentlyViewed';
import { rankCandidates } from '@/src/utils/recommendations';
import { ProductCard } from '@/src/components/ProductCard';
import { CATEGORY_SELECT } from '@/src/utils/categoryDisplay';

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
  const [products, setProducts] = useState<(Database['public']['Tables']['products']['Row'] & { categories?: any, category?: any })[]>([]);
  const { wishlistIds } = useWishlist();
  const { user } = useAuth();
  const theme = useColorScheme();
  const colors = Colors[theme];

  useEffect(() => {
    let cancelled = false;

    const fetchRecommendations = async () => {
      const recentIds = await getRecentlyViewed(user?.id);
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
        .select(`*, ${CATEGORY_SELECT}`)
        .in('category_id', poolCategoryIds)
        .neq('id', currentProductId)
        .eq('deleted', false)
        .eq('visibility', 'public')
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
  }, [mainCategoryId, currentProductId, currentSubCategoryId, wishlistIds, user?.id]);

  if (products.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>You May Also Like</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={products}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }: { item: any }) => <ProductCard product={item} variant="rail" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xxl,
    marginBottom: Spacing.xxl,
  },
  title: {
    ...Type.subtitle,
    marginBottom: Spacing.lg,
    marginLeft: Spacing.xxl,
  },
  list: {
    paddingLeft: Spacing.xxl,
    paddingRight: 10,
  },
});
