import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
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
import { IconSymbol } from '@/components/ui/icon-symbol';
import { CATEGORY_SELECT, getMainCategoryName, WithCategoryEmbed } from '@/src/utils/categoryDisplay';
import { RecentlyViewed } from '@/src/components/RecentlyViewed';
import { useToast } from '@/src/context/ToastContext';
import { ProductCard } from '@/src/components/ProductCard';
import { CategoryCard } from '@/src/components/CategoryCard';
import { GRID_GUTTER } from '@/src/utils/layout';
import { getCategoryAffinity, recordCategoryVisit, sortByAffinity } from '@/src/utils/categoryAffinity';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
type Category = Database['public']['Tables']['categories']['Row'];

export default function HomeScreen() {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [trendingProducts, setTrendingProducts] = useState<Product[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [topCategories, setTopCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const router = useRouter();

  const fetchProducts = async () => {
    try {
      const [productsRes, categoriesRes] = await Promise.all([
        supabase
          .from('products')
          .select(`*, ${CATEGORY_SELECT}`)
          .eq('visibility', 'public')
          .eq('deleted', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('categories')
          .select('*')
          .is('parent_id', null)
          .order('sort_order', { ascending: true }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      const data = productsRes.data;
      if (data) {
        setAllProducts(data);

        // Null stock means the item predates stock tracking, so treat it as
        // available rather than hiding it (same reading as ProductCard).
        const inStock = (p: Product) => p.stock == null || p.stock > 0;
        const sellable = data.filter(inStock);
        const featuredInStock = sellable.filter((p) => p.is_featured);

        // The hero is the largest thing on the app's first screen, so it must
        // never be a product nobody can reserve. Prefer featured and in stock,
        // then anything in stock; fall back to the raw list only so the
        // section does not vanish if the whole catalog is sold out.
        const heroPool =
          featuredInStock.length >= 2 ? featuredInStock
          : sellable.length >= 2 ? sellable
          : data;
        setFeaturedProducts(heroPool.slice(0, 2));

        // Real popularity signal (same one Explore's "Most Popular" sort
        // trusts), not just "newest" mislabeled as trending. Sold-out items
        // sort last rather than being removed: they still carry browse value
        // and feed the back-in-stock notify flow.
        const byPopularity = [...data].sort((a, b) => {
          const stockDiff = Number(inStock(b)) - Number(inStock(a));
          if (stockDiff !== 0) return stockDiff;
          const reviewDiff = (b.review_count || 0) - (a.review_count || 0);
          if (reviewDiff !== 0) return reviewDiff;
          return (b.rating || 0) - (a.rating || 0);
        });
        setTrendingProducts(byPopularity.slice(0, 6));
      }
      if (categoriesRes.data) {
        // Ordered by what this device actually opens, falling back to the
        // staff-set sort_order for anything not yet tapped.
        const affinity = await getCategoryAffinity();
        setTopCategories(sortByAffinity(categoriesRes.data, affinity));
      }
    } catch (err) {
      // Left silent, a failed load rendered as an empty catalog rather than a
      // visible failure -- indistinguishable from the store genuinely having
      // nothing yet.
      console.error(err);
      showToast('Could not load the latest products. Pull down to refresh.', 'error');
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
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.mainFeature}
                accessibilityRole="button"
                accessibilityLabel={`Featured: ${mainFeature.name}`}
                accessibilityHint="Opens product details"
              >
                <Image
                  source={mainFeature.image_url ? { uri: mainFeature.image_url } : require('@/assets/images/partial-react-logo.png')}
                  style={[styles.mainFeatureImage, { backgroundColor: colors.imagePlaceholder }]}
                  contentFit="cover"
                />
                <View style={styles.mainFeatureTextContainer}>
                  <Text style={[styles.featureBrand, { color: colors.text }]}>
                    {(getMainCategoryName(mainFeature) ?? 'EDITORIAL').toUpperCase()}
                  </Text>
                  <Text style={[styles.featureName, { color: colors.text }]} numberOfLines={2}>
                    {mainFeature.name}
                  </Text>
                </View>
              </TouchableOpacity>
            </Link>

            {secondaryFeature && (
              <Link href={`/product/${secondaryFeature.id}`} asChild>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.secondaryFeature}
                  accessibilityRole="button"
                  accessibilityLabel={`${secondaryFeature.name}, ₱${(secondaryFeature.sale_price || secondaryFeature.price || 0).toLocaleString()}`}
                  accessibilityHint="Opens product details"
                >
                  <Image
                    source={secondaryFeature.image_url ? { uri: secondaryFeature.image_url } : require('@/assets/images/partial-react-logo.png')}
                    style={[styles.secondaryFeatureImage, { backgroundColor: colors.imagePlaceholder }]}
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

        {/* 2. Shop by Category (real categories, deep-links into Explore) */}
        {topCategories.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Shop by Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editsScrollContainer}>
              {topCategories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  variant="rail"
                  onPress={() => {
                    recordCategoryVisit(cat.name);
                    router.push(`/(tabs)/explore?category=${encodeURIComponent(cat.name)}` as any);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* 3. Trending Grid -- sorted by real popularity (review_count/rating),
            not just newest, so the "Trending" label is actually accurate. */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, paddingHorizontal: 0 }]}>Trending Now</Text>
            {allProducts.length > 6 && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/explore?all=1' as any)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="See all products"
              >
                <Text style={[styles.seeAllText, { color: colors.tint }]}>See All</Text>
              </TouchableOpacity>
            )}
          </View>

          {trendingProducts.length === 0 ? (
            <View style={styles.emptyProductsState}>
              <IconSymbol name="bag.fill" size={40} color={colors.secondaryText} />
              <Text style={[styles.emptyProductsText, { color: colors.secondaryText }]}>
                No products available yet. Check back soon.
              </Text>
            </View>
          ) : (
            <View style={styles.gridContainer}>
              {trendingProducts.map((item) => (
                <ProductCard key={item.id} product={item} variant="grid" />
              ))}
            </View>
          )}
        </View>

        <RecentlyViewed />

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
    // Clears the floating tab bar, whose offset now follows the bottom
    // safe-area inset and so is taller on three-button navigation.
    paddingBottom: 120,
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
  },
  mainFeatureTextContainer: {
    marginTop: 12,
  },
  featureBrand: {
    fontSize: 12,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyProductsState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 12,
  },
  emptyProductsText: {
    fontSize: 14,
    textAlign: 'center',
  },
  editsScrollContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },

  // Trending Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Feeds gridCardWidth via GRID_GUTTER, same as Explore's grid.
    paddingHorizontal: GRID_GUTTER,
    justifyContent: 'space-between',
  },
});
