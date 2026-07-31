import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { getRecentlyViewed } from '@/src/utils/recentlyViewed';
import { ProductCard } from '@/src/components/ProductCard';
import { CATEGORY_SELECT } from '@/src/utils/categoryDisplay';

export function RecentlyViewed({ excludeProductId }: { excludeProductId?: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const theme = useColorScheme();
  const colors = Colors[theme];

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        const ids = (await getRecentlyViewed()).filter(id => id !== excludeProductId);
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
        setProducts(ids.map(id => byId.get(id)).filter(Boolean));
      };
      load();
      return () => { active = false; };
    }, [excludeProductId])
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
        renderItem={({ item }) => <ProductCard product={item} variant="rail" />}
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
    paddingRight: 10,
  },
});
