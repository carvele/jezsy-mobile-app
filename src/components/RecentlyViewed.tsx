import type { Database } from '@/src/types/database.types';
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { getRecentlyViewed } from '@/src/utils/recentlyViewed';
import { ProductCard } from '@/src/components/ProductCard';
import { CATEGORY_SELECT } from '@/src/utils/categoryDisplay';
import { useAuth } from '@/src/context/AuthContext';

export function RecentlyViewed({ excludeProductId }: { excludeProductId?: string }) {
  const [products, setProducts] = useState<(Database['public']['Tables']['products']['Row'] & { categories?: any, category?: any })[]>([]);
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user } = useAuth();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        const ids = (await getRecentlyViewed(user?.id)).filter(id => id !== excludeProductId);
        if (ids.length === 0) {
          if (active) setProducts([]);
          return;
        }
        // Category embed included so ProductCard's eyebrow has something to show.
        const { data } = await supabase
          .from('products')
          .select(`*, ${CATEGORY_SELECT}`)
          .in('id', ids)
          .eq('deleted', false)
          .eq('visibility', 'public');
        if (!active) return;
        // Preserve most-recent-first order; the IN query returns arbitrary order.
        const byId = new Map((data || []).map(p => [p.id, p]));
        setProducts(ids.filter(id => byId.has(id)).map(id => byId.get(id)!));
      };
      load();
      return () => { active = false; };
    }, [excludeProductId, user?.id])
  );

  if (products.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Recently Viewed</Text>
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
