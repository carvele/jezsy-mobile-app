import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { getRecentlyViewed } from '@/src/utils/recentlyViewed';

export function RecentlyViewed({ excludeProductId }: { excludeProductId?: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
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
        const { data } = await supabase.from('products').select('*').in('id', ids);
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
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/product/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`}
          >
            <Image
              source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
              style={[styles.image, { backgroundColor: colors.imagePlaceholder }]}
              contentFit="cover"
            />
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.price, { color: colors.tint }]}>
              ₱{(item.on_sale && item.sale_price ? item.sale_price : item.price || 0).toFixed(2)}
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
    width: 120,
    marginRight: 16,
  },
  image: {
    width: 120,
    height: 156,
    borderRadius: 12,
    marginBottom: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
  },
});
