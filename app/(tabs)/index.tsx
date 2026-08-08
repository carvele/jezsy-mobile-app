import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Easing,
  Dimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CATEGORY_SELECT, getMainCategoryName, WithCategoryEmbed } from '@/src/utils/categoryDisplay';
import { RecentlyViewed } from '@/src/components/RecentlyViewed';
import { useToast } from '@/src/context/ToastContext';
import { ProductCard } from '@/src/components/ProductCard';
import { CategoryCard } from '@/src/components/CategoryCard';
import { GRID_GUTTER } from '@/src/utils/layout';
import { isInStock } from '@/src/utils/stock';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { getCategoryAffinity, recordCategoryVisit, sortByAffinity } from '@/src/utils/categoryAffinity';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
type Category = Database['public']['Tables']['categories']['Row'];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// The card occupies 1/phi of the screen (~61.8%) rather than a hand-picked
// fraction -- golden-ratio framing that also reads noticeably less dominant
// than the original 78%, with a bigger neighbor peek as the direct result.
const GOLDEN_RATIO = 1.618;
const HERO_CARD_WIDTH = SCREEN_WIDTH / GOLDEN_RATIO;
const HERO_CARD_GAP = Spacing.md;
// Safety cap, not a real limit: nothing stops a merchant flagging thirty
// products is_featured, and a thirty-dot carousel is not a hero section.
const HERO_MAX_CARDS = 8;

export default function HomeScreen() {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [trendingProducts, setTrendingProducts] = useState<Product[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [topCategories, setTopCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // heroIndex is the dot/real-product index (0..featuredProducts.length-1).
  // heroExtendedIndex tracks position within the looped array, which has a
  // clone of the last card prepended and a clone of the first appended --
  // the standard trick for a ScrollView that swipes past either end into
  // more content instead of bouncing off a hard stop.
  const [heroIndex, setHeroIndex] = useState(0);
  const heroScrollX = useRef(new Animated.Value(0)).current;
  // Separate from heroScrollX, which is native-driven off real onScroll
  // events and can't also be JS-driven without React Native's "already
  // using native driver" conflict -- this one exists purely to hand
  // auto-advance its own frame-by-frame values.
  const heroAutoScrollDriver = useRef(new Animated.Value(0)).current;
  const heroScrollRef = useRef<ScrollView>(null);
  const heroExtendedIndexRef = useRef(1);
  const heroInteractingRef = useRef(false);

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
          // id as a tiebreak: rows seeded in the same batch share one
          // created_at, and Postgres does not promise a stable order for
          // ties on that alone -- the hero section could silently swap
          // which of two featured products got the large slot between
          // loads. id is unique per row, so this makes every consumer of
          // `data` (hero pool, trending sort, search) deterministic.
          .order('created_at', { ascending: false })
          .order('id', { ascending: true }),
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

        const sellable = data.filter(isInStock);
        const featuredInStock = sellable.filter((p) => p.is_featured);

        // The hero is the largest thing on the app's first screen, so it must
        // never be a product nobody can reserve. Prefer featured and in stock,
        // then anything in stock; fall back to the raw list only so the
        // section does not vanish if the whole catalog is sold out.
        const heroPool =
          featuredInStock.length >= 2 ? featuredInStock
          : sellable.length >= 2 ? sellable
          : data;
        setFeaturedProducts(heroPool.slice(0, HERO_MAX_CARDS));

        // Real popularity signal (same one Explore's "Most Popular" sort
        // trusts), not just "newest" mislabeled as trending. Sold-out items
        // sort last rather than being removed: they still carry browse value
        // and feed the back-in-stock notify flow.
        const byPopularity = [...data].sort((a, b) => {
          const stockDiff = Number(isInStock(b)) - Number(isInStock(a));
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

  // Focus, not mount-only: Shop by Category's order depends on affinity
  // counts that recordCategoryVisit writes when the user taps into a
  // category, so coming back from Explore needs a re-sort, not just the
  // Home tab's very first load.
  useFocusEffect(
    useCallback(() => {
      fetchProducts();
    }, [])
  );

  // Lands on a clone (extended index 0 or featuredProducts.length + 1) and
  // instantly, unanimatedly repositions onto the identical real card at the
  // opposite end -- since the clone and its real counterpart render
  // pixel-identical, the jump is imperceptible and the loop reads seamless.
  const settleHeroLoop = useCallback((extendedIdx: number) => {
    if (featuredProducts.length <= 1) return;
    const step = HERO_CARD_WIDTH + HERO_CARD_GAP;
    const lastExtendedIdx = featuredProducts.length + 1;
    if (extendedIdx === 0) {
      heroScrollRef.current?.scrollTo({ x: featuredProducts.length * step, animated: false });
      heroExtendedIndexRef.current = featuredProducts.length;
    } else if (extendedIdx === lastExtendedIdx) {
      heroScrollRef.current?.scrollTo({ x: step, animated: false });
      heroExtendedIndexRef.current = 1;
    } else {
      heroExtendedIndexRef.current = extendedIdx;
    }
  }, [featuredProducts.length]);

  // Auto-advances the hero every 4s, pausing while a finger is on it so it
  // never fights a manual swipe or moves content out from under a mid-read
  // tap. Drives the scroll itself via a JS-side Animated.timing rather than
  // ScrollView's own scrollTo(animated: true) -- Android's native smooth-
  // scroll easing under the New Architecture reads as visibly jittery for
  // this kind of short, frequent, programmatic scroll, and a hand-driven
  // timing loop sidesteps it entirely by calling scrollTo(..., false) once
  // per animation frame instead.
  useEffect(() => {
    if (featuredProducts.length <= 1) return;
    const step = HERO_CARD_WIDTH + HERO_CARD_GAP;
    const timer = setInterval(() => {
      if (heroInteractingRef.current) return;
      const nextExtended = heroExtendedIndexRef.current + 1;
      heroAutoScrollDriver.setValue(heroExtendedIndexRef.current * step);
      const listenerId = heroAutoScrollDriver.addListener(({ value }) => {
        heroScrollRef.current?.scrollTo({ x: value, animated: false });
      });
      Animated.timing(heroAutoScrollDriver, {
        toValue: nextExtended * step,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        heroAutoScrollDriver.removeListener(listenerId);
        settleHeroLoop(nextExtended);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [featuredProducts.length, settleHeroLoop, heroAutoScrollDriver]);

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

  // Clone of the last card in front and the first card behind so a swipe
  // past either edge lands on real-looking content instead of a hard stop;
  // the boundary-snap on the ScrollView then silently re-centers onto the
  // matching real card once the clone settles into view.
  const heroLoops = featuredProducts.length > 1;
  const loopedHeroProducts = heroLoops
    ? [featuredProducts[featuredProducts.length - 1], ...featuredProducts, featuredProducts[0]]
    : featuredProducts;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
        }
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
      >
        {/* Top Header */}
        <View style={styles.header}>
          <Text style={[styles.brandLogo, { color: colors.text }]}>JezSy</Text>
        </View>

        {/* 1. Featured Carousel. Auto-advances (see the effect above) but
            pauses the instant a finger touches it, so it never fights a
            manual swipe or shifts content out from under a mid-read tap.
            Scales the same way from 1 card (no dots, nothing to advance to)
            up to HERO_MAX_CARDS. */}
        {featuredProducts.length > 0 && (
          <View style={styles.editorialSection}>
            <Animated.ScrollView
              ref={heroScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={HERO_CARD_WIDTH + HERO_CARD_GAP}
              decelerationRate="fast"
              contentContainerStyle={styles.heroCarouselContent}
              contentOffset={heroLoops ? { x: HERO_CARD_WIDTH + HERO_CARD_GAP, y: 0 } : undefined}
              onScrollBeginDrag={() => { heroInteractingRef.current = true; }}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                heroInteractingRef.current = false;
                const step = HERO_CARD_WIDTH + HERO_CARD_GAP;
                settleHeroLoop(Math.round(e.nativeEvent.contentOffset.x / step));
              }}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: heroScrollX } } }],
                {
                  useNativeDriver: true,
                  listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const step = HERO_CARD_WIDTH + HERO_CARD_GAP;
                    const idx = Math.round(e.nativeEvent.contentOffset.x / step);
                    const real = heroLoops
                      ? (idx - 1 + featuredProducts.length) % featuredProducts.length
                      : idx;
                    setHeroIndex(Math.max(0, Math.min(real, featuredProducts.length - 1)));
                  },
                }
              )}
              scrollEventThrottle={16}
            >
              {loopedHeroProducts.map((item, index) => {
                // Neighbors sit at 92% scale and dim to 1/phi opacity -- the
                // same "focus" language a physical gallery rail uses, so the
                // card under a finger always reads as the one being looked
                // at.
                const step = HERO_CARD_WIDTH + HERO_CARD_GAP;
                const inputRange = [(index - 1) * step, index * step, (index + 1) * step];
                const scale = heroScrollX.interpolate({
                  inputRange,
                  outputRange: [0.92, 1, 0.92],
                  extrapolate: 'clamp',
                });
                const opacity = heroScrollX.interpolate({
                  inputRange,
                  outputRange: [1 / GOLDEN_RATIO, 1, 1 / GOLDEN_RATIO],
                  extrapolate: 'clamp',
                });
                return (
                  <TouchableOpacity
                    key={`${item.id}-${index}`}
                    activeOpacity={0.9}
                    style={[styles.heroCard, index === loopedHeroProducts.length - 1 && styles.heroCardLast]}
                    onPress={() => router.push(`/product/${item.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Featured: ${item.name}, ₱${(item.sale_price || item.price || 0).toLocaleString()}`}
                    accessibilityHint="Opens product details"
                  >
                    <Animated.View style={{ transform: [{ scale }], opacity }}>
                      <Image
                        source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                        style={[styles.heroCardImage, { backgroundColor: colors.imagePlaceholder }]}
                        contentFit="cover"
                      />
                      <View style={styles.heroCardTextContainer}>
                        <Text style={[styles.featureBrand, { color: colors.text }]}>
                          {(getMainCategoryName(item) ?? 'EDITORIAL').toUpperCase()}
                        </Text>
                        <Text style={[styles.featureName, { color: colors.text }]} numberOfLines={2}>
                          {item.name}
                        </Text>
                        <Text style={[styles.featurePrice, { color: colors.secondaryText }]}>
                          ₱{(item.sale_price || item.price || 0).toLocaleString()}
                        </Text>
                      </View>
                    </Animated.View>
                  </TouchableOpacity>
                );
              })}
            </Animated.ScrollView>

            {featuredProducts.length > 1 && (
              <View style={styles.heroDots} accessibilityElementsHidden importantForAccessibility="no">
                {featuredProducts.map((item, i) => (
                  <View
                    key={item.id}
                    style={[
                      styles.heroDot,
                      { backgroundColor: i === heroIndex ? colors.tint : colors.hairline },
                    ]}
                  />
                ))}
              </View>
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
            <BrandEmptyState
              icon="bag.fill"
              title="Nothing here yet"
              message="New pieces are on their way. Check back soon."
            />
          ) : (
            <View style={styles.gridContainer}>
              {trendingProducts.map((item) => (
                <ProductCard key={item.id} product={item} variant="grid" />
              ))}
            </View>
          )}
        </View>

        <RecentlyViewed />
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
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
    marginTop: 10,
    marginBottom: 40,
  },
  // The peek past the screen edge is the swipe affordance, so the row
  // itself carries no horizontal padding -- each card supplies its own via
  // marginRight, and the leading card starts flush with the header above.
  heroCarouselContent: {
    paddingLeft: Spacing.xl,
  },
  heroCard: {
    width: HERO_CARD_WIDTH,
    marginRight: HERO_CARD_GAP,
  },
  // The trailing edge needs its own visible margin too, since
  // contentContainerStyle's paddingLeft has no paddingRight counterpart to
  // balance it -- without this the last card's peek runs off-screen instead
  // of resting against it like every other gap in the row.
  heroCardLast: {
    marginRight: Spacing.xl,
  },
  heroCardImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.sm,
  },
  heroCardTextContainer: {
    marginTop: Spacing.md,
  },
  featureBrand: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  featureName: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    marginBottom: Spacing.xs,
  },
  featurePrice: {
    fontSize: 13,
    fontWeight: '500',
  },
  heroDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.lg,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Edits Section
  sectionContainer: {
    marginBottom: 40,
  },
  sectionTitle: {
    ...Type.title,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyProductsState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyProductsText: {
    ...Type.body,
    textAlign: 'center',
  },
  editsScrollContainer: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
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
