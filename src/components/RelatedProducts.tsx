import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';

export function RelatedProducts({ category, currentProductId }: { category: string; currentProductId: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!category) return;
    
    const fetchRelated = async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('category', category)
        .neq('id', currentProductId)
        .limit(6);
        
      if (data) {
        setProducts(data);
      }
    };
    
    fetchRelated();
  }, [category, currentProductId]);

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
