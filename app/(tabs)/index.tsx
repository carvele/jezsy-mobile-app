import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Product = Database['public']['Tables']['products']['Row'];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Define specific curated edits (collections)
const CURATED_EDITS = [
  { id: 'summer', title: 'The Summer Edit', subtitle: 'Lightweight essentials', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600' },
  { id: 'minimalist', title: 'Minimalist Core', subtitle: 'Clean lines, neutral tones', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600' },
  { id: 'archive', title: 'The Archive', subtitle: 'Timeless vintage pieces', image: 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=600' },
  { id: 'denim', title: 'Denim Collection', subtitle: 'Classic & raw denim', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600' },
];

export default function HomeScreen() {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];
  const router = useRouter();

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('visibility', 'public')
        .eq('deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (data) {
        setAllProducts(data);
        const featured = data.filter((p) => p.is_featured);
        // Fallback to top 2 products for the editorial header if no featured items exist
        setFeaturedProducts(featured.length >= 2 ? featured : data.slice(0, 2));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts();
  }, []);

  if (loading && !refreshing) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  const mainFeature = featuredProducts[0];
  const secondaryFeature = featuredProducts[1];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Top Header */}
        <View style={styles.header}>
          <Text style={[styles.brandLogo, { color: colors.text }]}>JezSy</Text>
        </View>

        {/* 1. Editorial Featured Section (Asymmetric / Magazine style) */}
        {mainFeature && (
          <View style={styles.editorialSection}>
            <Link href={`/product/${mainFeature.id}`} asChild>
              <TouchableOpacity activeOpacity={0.9} style={styles.mainFeature}>
                <Image
                  source={mainFeature.image_url ? { uri: mainFeature.image_url } : require('@/assets/images/partial-react-logo.png')}
                  style={styles.mainFeatureImage}
                  contentFit="cover"
                />
                <View style={styles.mainFeatureTextContainer}>
                  <Text style={[styles.featureBrand, { color: colors.text }]}>
                    {mainFeature.category?.toUpperCase() || 'EDITORIAL'}
                  </Text>
                  <Text style={[styles.featureName, { color: colors.text }]} numberOfLines={2}>
                    {mainFeature.name}
                  </Text>
                </View>
              </TouchableOpacity>
            </Link>

            {secondaryFeature && (
              <Link href={`/product/${secondaryFeature.id}`} asChild>
                <TouchableOpacity activeOpacity={0.9} style={styles.secondaryFeature}>
                  <Image
                    source={secondaryFeature.image_url ? { uri: secondaryFeature.image_url } : require('@/assets/images/partial-react-logo.png')}
                    style={styles.secondaryFeatureImage}
                    contentFit="cover"
                  />
                  <View style={styles.secondaryFeatureTextContainer}>
                    <Text style={[styles.featureNameSmall, { color: colors.text }]} numberOfLines={1}>
                      {secondaryFeature.name}
                    </Text>
                    <Text style={[styles.featurePrice, { color: colors.secondaryText }]}>
                      ₱{(secondaryFeature.sale_price || secondaryFeature.price || 0).toLocaleString()}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Link>
            )}
          </View>
        )}

        {/* 2. Shop by Edit (Curated Portrait Cards) */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>The Edits</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editsScrollContainer}>
            {CURATED_EDITS.map((edit) => (
              <TouchableOpacity 
                key={edit.id} 
                style={styles.editCard}
                onPress={() => router.push('/(tabs)/explore')} // Route to explore for now
                activeOpacity={0.9}
              >
                <Image source={{ uri: edit.image }} style={styles.editImage} contentFit="cover" />
                <View style={styles.editOverlay} />
                <View style={styles.editTextContainer}>
                  <Text style={styles.editTitle}>{edit.title}</Text>
                  <Text style={styles.editSubtitle}>{edit.subtitle}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 3. Trending Grid (2-column layout right on the home page) */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Trending Now</Text>
          
          <View style={styles.gridContainer}>
            {allProducts.slice(0, 6).map((item) => (
              <Link key={item.id} href={`/product/${item.id}`} asChild>
                <TouchableOpacity style={styles.gridCard} activeOpacity={0.85}>
                  <View style={styles.gridImageContainer}>
                    <Image
                      source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                      style={styles.gridImage}
                      contentFit="cover"
                    />
                    {item.is_new_arrival && (
                      <View style={[styles.gridBadge, { backgroundColor: colors.tint }]}>
                        <Text style={styles.gridBadgeText}>NEW</Text>
                      </View>
                    )}
                    {item.model_3d_url && (
                      <View style={[styles.gridBadge, { backgroundColor: 'rgba(201,169,110,0.9)', top: item.is_new_arrival ? 32 : 8, flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
                        <IconSymbol name="cube.transparent" size={10} color="#0D0D0D" />
                        <Text style={styles.gridBadgeText}>AR</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.gridInfo}>
                    <Text style={[styles.gridBrand, { color: colors.secondaryText }]}>
                      {item.sub_category?.toUpperCase() || item.category?.toUpperCase() || 'BRAND'}
                    </Text>
                    <Text style={[styles.gridName, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.gridPrice, { color: colors.text }]}>
                      ₱{(item.sale_price || item.price || 0).toLocaleString()}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Link>
            ))}
          </View>
        </View>

        {/* Footer padding to not overlap with bottom tabs */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 0,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandLogo: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  
  // Editorial Section
  editorialSection: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  mainFeature: {
    width: '60%',
  },
  mainFeatureImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  mainFeatureTextContainer: {
    marginTop: 12,
  },
  featureBrand: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  featureName: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  secondaryFeature: {
    width: '35%',
    marginTop: 80, // Staggered effect
  },
  secondaryFeatureImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  secondaryFeatureTextContainer: {
    marginTop: 12,
  },
  featureNameSmall: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  featurePrice: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Edits Section
  sectionContainer: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  editsScrollContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  editCard: {
    width: SCREEN_WIDTH * 0.65,
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
  },
  editImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  editOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  editTextContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  editTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  editSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Trending Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  gridCard: {
    width: '48%', // Ensure exact 2-column fit with small gap
    marginBottom: 24,
  },
  gridImageContainer: {
    width: '100%',
    aspectRatio: 3 / 4, // Strict 3:4 fashion ratio
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginBottom: 10,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  gridBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  gridBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D0D0D',
  },
  gridInfo: {
    paddingHorizontal: 4,
  },
  gridBrand: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  gridName: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  gridPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
});
