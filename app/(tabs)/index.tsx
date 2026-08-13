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
  useWindowDimensions,
  Pressable,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { CATEGORY_SELECT, getMainCategoryName, WithCategoryEmbed } from '@/src/utils/categoryDisplay';
import { RecentlyViewed } from '@/src/components/RecentlyViewed';
import { useToast } from '@/src/context/ToastContext';
import { cacheProductCatalog, getCachedCatalog, OfflineProduct } from '@/src/services/offlineSync';
import { ProductCard } from '@/src/components/ProductCard';
import { CategoryCard } from '@/src/components/CategoryCard';
import { GRID_GUTTER } from '@/src/utils/layout';
import { isInStock } from '@/src/utils/stock';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { getCategoryAffinity, recordCategoryVisit, sortByAffinity } from '@/src/utils/categoryAffinity';
import { StyleGallery } from '@/components/StyleGallery';
import { useWishlist } from '@/src/context/WishlistContext';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
type Category = Database['public']['Tables']['categories']['Row'];

// The card occupies 1/phi of the screen (~61.8%) rather than a hand-picked
// fraction -- golden-ratio framing that also reads noticeably less dominant
// than the original 78%, with a bigger neighbor peek as the direct result.
// Derived from useWindowDimensions() inside the component (not a module-
// level Dimensions.get() snapshot) so it stays correct across rotation and
// foldable resize instead of freezing at whatever size the app happened to
// cold-start at.
const GOLDEN_RATIO = 1.618;
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
  const heroScrollRef = useRef<ScrollView>(null);
  const heroExtendedIndexRef = useRef(1);
  const heroInteractingRef = useRef(false);
  const { width: screenWidth } = useWindowDimensions();
  const heroCardWidth = screenWidth / GOLDEN_RATIO;

  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const router = useRouter();

  const fetchProducts = async (fromCache = false) => {
    // Immediately seed UI from cache so there's something to look at before the
    // network responds. fromCache=true is used by the mount-time call to avoid
    // showing a loading spinner when stale data is already available.
    if (fromCache) {
      const cached = await getCachedCatalog();
      if (cached) {
        const data = cached as any[];
        const sellable = data.filter(isInStock);
        const featuredInStock = sellable.filter((p) => p.is_featured);
        const heroPool = featuredInStock.length >= 2 ? featuredInStock : sellable.length >= 2 ? sellable : data;
        setFeaturedProducts(heroPool.slice(0, HERO_MAX_CARDS));
        const byPopularity = [...data].sort((a, b) => {
          const stockDiff = Number(isInStock(b)) - Number(isInStock(a));
          if (stockDiff !== 0) return stockDiff;
          const reviewDiff = (b.review_count || 0) - (a.review_count || 0);
          if (reviewDiff !== 0) return reviewDiff;
          return (b.rating || 0) - (a.rating || 0);
        });
        setTrendingProducts(byPopularity.slice(0, 6));
        setAllProducts(data);
        setLoading(false);
        return; // Don't hit network if we seeded from a valid cache
      }
    }
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
        // Write a fresh catalog snapshot to AsyncStorage for offline use.
        cacheProductCatalog(data as unknown as OfflineProduct[]).catch(() => {});

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

  // Seed UI from cached data immediately on cold start, then let the network
  // call (above) overwrite with fresher data when it resolves.
  useEffect(() => {
    fetchProducts(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lands on a clone (extended index 0 or featuredProducts.length + 1) and
  // instantly, unanimatedly repositions onto the identical real card at the
  // opposite end -- since the clone and its real counterpart render
  // pixel-identical, the jump is imperceptible and the loop reads seamless.
  const settleHeroLoop = useCallback((extendedIdx: number) => {
    if (featuredProducts.length <= 1) return;
    const step = heroCardWidth + HERO_CARD_GAP;
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
  }, [featuredProducts.length, heroCardWidth]);

  // Auto-advances the hero every 4s, pausing while a finger is on it so it
  // never fights a manual swipe or moves content out from under a mid-read
  // tap.
  //
  // Previously hand-rolled a JS-thread Animated.timing loop that called
  // scrollTo(..., false) once per animation frame, on the theory that
  // native scrollTo(animated: true) was the jittery one. That was wrong,
  // and made things worse: each of those ~60 per-second imperative scrollTo
  // calls is a discrete native scroll command, not a continuous motion, so
  // under any JS-thread contention it reads as the carousel jumping/
  // re-rendering rather than sliding, and the pagination dots (driven off
  // the same choppy onScroll events) drift out of sync with it too.
  //
  // The actual fix is smaller: trust the native animated scroll, and let
  // the onMomentumScrollEnd handler below -- which already exists and
  // already calls settleHeroLoop correctly -- be the ONLY place that
  // decides when to settle the loop. It fires after any scroll completes,
  // whether from this auto-advance or a manual swipe, so there's no
  // guessed timing and no race between an unfinished animation and an
  // instant loop-snap landing mid-flight.
  useEffect(() => {
    if (featuredProducts.length <= 1) return;
    const step = heroCardWidth + HERO_CARD_GAP;
    const timer = setInterval(() => {
      if (heroInteractingRef.current) return;
      const nextExtended = heroExtendedIndexRef.current + 1;
      heroExtendedIndexRef.current = nextExtended;
      heroScrollRef.current?.scrollTo({ x: nextExtended * step, animated: true });
    }, 4000);
    return () => clearInterval(timer);
  }, [featuredProducts.length, heroCardWidth]);

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
              snapToInterval={heroCardWidth + HERO_CARD_GAP}
              decelerationRate="fast"
              contentContainerStyle={styles.heroCarouselContent}
              contentOffset={heroLoops ? { x: heroCardWidth + HERO_CARD_GAP, y: 0 } : undefined}
              onScrollBeginDrag={() => { heroInteractingRef.current = true; }}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                heroInteractingRef.current = false;
                const step = heroCardWidth + HERO_CARD_GAP;
                settleHeroLoop(Math.round(e.nativeEvent.contentOffset.x / step));
              }}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: heroScrollX } } }],
                {
                  useNativeDriver: true,
                  listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const step = heroCardWidth + HERO_CARD_GAP;
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
                const step = heroCardWidth + HERO_CARD_GAP;
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
                const saved = isInWishlist(item.id);
                const stock: number | null | undefined = item.stock;
                const hasStock = stock !== null && stock !== undefined;
                const outOfStock = hasStock && stock <= 0;
                const lowStock = hasStock && stock > 0 && stock <= 5;
                const stockLabel = !hasStock
                  ? null
                  : outOfStock
                    ? 'Out of stock'
                    : lowStock
                      ? `Only ${stock} left`
                      : `${stock} in stock`;
                const stockColor = outOfStock ? colors.error : lowStock ? colors.warning : colors.secondaryText;

                return (
                  <TouchableOpacity
                    key={`${item.id}-${index}`}
                    activeOpacity={0.9}
                    style={[styles.heroCard, { width: heroCardWidth }, index === loopedHeroProducts.length - 1 && styles.heroCardLast]}
                    onPress={() => router.push(`/product/${item.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Featured: ${item.name}, ₱${(item.sale_price || item.price || 0).toLocaleString()}`}
                    accessibilityHint="Opens product details"
                  >
                    <Animated.View style={{ transform: [{ scale }], opacity }}>
                      <View style={{ position: 'relative' }}>
                        <Image
                          source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                          style={[styles.heroCardImage, { backgroundColor: colors.imagePlaceholder }]}
                          contentFit="cover"
                        />
                        {/* Left Column Tag Badges */}
                        <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6, zIndex: 10 }}>
                          {(item.is_new_arrival || (item.tags && item.tags.includes('New Arrival'))) && (
                            <View style={{ backgroundColor: colors.tint, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 }}>
                              <Text style={{ color: colors.onTint, fontSize: 10, fontWeight: '800' }}>NEW</Text>
                            </View>
                          )}
                          {(item.on_sale || item.sale_price) && (
                            <View style={{ backgroundColor: colors.notification, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 }}>
                              <Text style={{ color: colors.onNotification, fontSize: 10, fontWeight: '800' }}>
                                {item.discount_percentage ? `-${item.discount_percentage}%` : 'SALE'}
                              </Text>
                            </View>
                          )}
                          {(item.model_3d_url || (item.tags && item.tags.includes('AR Try-On'))) && (
                            <View style={{ backgroundColor: '#6366f1', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                              <IconSymbol name="cube.transparent" size={10} color="#ffffff" />
                              <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800' }}>AR</Text>
                            </View>
                          )}
                        </View>

                        {/* Top-Right Wishlist Heart Button */}
                        <Pressable
                          style={{ position: 'absolute', top: 8, right: 8, zIndex: 12 }}
                          onPress={() => toggleWishlist(item.id)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={saved ? `Remove ${item.name} from wishlist` : `Save ${item.name} to wishlist`}
                        >
                          <BlurView intensity={40} tint="light" style={styles.heroHeartBg}>
                            <IconSymbol
                              name={saved ? 'heart.fill' : 'heart'}
                              size={16}
                              color={saved ? Colors.dark.blushFill : '#FFF'}
                            />
                          </BlurView>
                        </Pressable>
                      </View>

                      <View style={styles.heroCardTextContainer}>
                        <Text style={[styles.featureBrand, { color: colors.secondaryText }]} numberOfLines={1}>
                          {(getMainCategoryName(item) ?? 'COLLECTION').toUpperCase()}
                        </Text>
                        <Text style={[styles.featureName, { color: colors.text }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {item.on_sale && item.sale_price ? (
                            <>
                              <Text style={[styles.featurePrice, { color: colors.notification, fontWeight: '700' }]}>
                                ₱{item.sale_price.toLocaleString()}
                              </Text>
                              <Text style={[styles.featurePrice, { color: colors.secondaryText, textDecorationLine: 'line-through', fontSize: 12 }]}>
                                ₱{item.price?.toLocaleString()}
                              </Text>
                            </>
                          ) : (
                            <Text style={[styles.featurePrice, { color: colors.text, fontWeight: '700' }]}>
                              ₱{(item.price || 0).toLocaleString()}
                            </Text>
                          )}
                        </View>
                        {stockLabel && (
                          <Text style={{ fontSize: 12, fontWeight: '600', color: stockColor, marginTop: 2 }}>
                            {stockLabel}
                          </Text>
                        )}
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
                      i === heroIndex && styles.heroDotActive,
                      { backgroundColor: i === heroIndex ? colors.tint : colors.hairline },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Style Inspiration Feed (StyleHint-inspired Pose Discovery) */}
        <StyleGallery />

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
  // marginBottom trimmed from a hardcoded 40 to the xl token (20) -- the
  // extra 20px was just dead vertical space between the dots and the next
  // section, not doing anything for the carousel itself.
  editorialSection: {
    marginTop: 10,
    marginBottom: Spacing.xl,
  },
  // The peek past the screen edge is the swipe affordance, so the row
  // itself carries no horizontal padding -- each card supplies its own via
  // marginRight, and the leading card starts flush with the header above.
  heroCarouselContent: {
    paddingLeft: Spacing.xl,
  },
  // width is applied inline (heroCardWidth, from useWindowDimensions) since
  // it now varies with the live window size rather than being fixed at
  // whatever size the app cold-started at.
  heroCard: {
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
  // Hierarchy: category label is the smallest, mutedest text (secondaryText
  // color, applied at the call site) -- purely context, never competes for
  // attention. Product name is the heaviest weight of the three text rows so
  // it reads as the primary element after the image itself. Price stays
  // smaller than the name but bold (weight applied at the call site) so it's
  // still a clear, scannable secondary signal, not buried.
  featureBrand: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  featureName: {
    fontSize: 18,
    fontWeight: '700',
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
  heroDotActive: {
    width: 20,
    borderRadius: 4,
  },
  heroHeartBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
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
