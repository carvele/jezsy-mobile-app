import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing, Type as Typography } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSafeBack } from '@/src/hooks/useSafeBack';

interface StylePoseDetail {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
  description: string | null;
  occasion: string | null;
  difficulty: string | null;
  is_featured: boolean | null;
  base_pose_type: string | null;
}

interface LinkedProduct {
  id: string;
  name: string;
  image_url: string | null;
  rental_price: number | null;
  price: number | null;
  category: string | null;
}

export default function StylePoseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useSafeBack();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [pose, setPose] = useState<StylePoseDetail | null>(null);
  const [products, setProducts] = useState<LinkedProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchPoseAndProducts(id);
    }
  }, [id]);

  const fetchPoseAndProducts = async (poseId: string) => {
    try {
      setLoading(true);
      // 1. Fetch Pose Guide
      const { data: poseData, error: poseError } = await supabase
        .from('pose_guides')
        .select('*')
        .eq('id', poseId)
        .single();

      if (poseError) throw poseError;
      setPose(poseData as StylePoseDetail);

      // 2. Fetch Linked Products
      const { data: linkData, error: linkError } = await supabase
        .from('pose_guide_products')
        .select('*, product:products(*)')
        .eq('pose_guide_id', poseId);

      if (linkError) {
        if ((linkError as any).code === 'PGRST205' || (linkError as any).code === '42P01') {
          setProducts([]);
        } else {
          console.error('Error fetching linked products:', linkError);
        }
      } else if (linkData) {
        const prods = linkData.map((item: any) => item.product).filter(Boolean);
        setProducts(prods);
      }
    } catch (e) {
      console.error('Error loading style pose detail:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTryInAR = () => {
    // No fallback product id: 'P-001' isn't a real row (products.id is a
    // uuid), and ar-tryon's non-uuid lookup path queries sku/display_id --
    // neither exists on products (sku is on inventory, display_id is on
    // reservations) -- so a look with no linked products always dead-ended
    // on "Product not found." The button below is hidden in that case
    // instead of routing somewhere that can't resolve.
    if (!pose || products.length === 0) return;
    router.push({
      pathname: `/ar-tryon/${products[0].id}` as any,
      params: { stylePoseId: pose.id },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </SafeAreaView>
    );
  }

  if (!pose) {
    return (
      <SafeAreaView style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>Style pose not found</Text>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.tint }]} onPress={goBack}>
          <Text style={[styles.backBtnText, { color: colors.onTint }]}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Navigation Bar */}
      <View style={[styles.navBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.navBackBtn} onPress={goBack}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
          {pose.name}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Styled Reference Photo */}
        <View style={[styles.heroImageContainer, { backgroundColor: colors.imagePlaceholder }]}>
          {pose.image_url ? (
            <Image
              source={{ uri: pose.image_url }}
              style={styles.heroImage}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <IconSymbol name="camera.fill" size={64} color={colors.tabIconDefault} />
            </View>
          )}

          {pose.occasion && (
            <View style={styles.heroOccasionBadge}>
              <Text style={styles.heroOccasionText}>{pose.occasion}</Text>
            </View>
          )}
        </View>

        {/* Pose Meta Card */}
        <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
          <View style={styles.titleRow}>
            <Text style={[styles.poseTitle, { color: colors.text }]}>{pose.name}</Text>
            {pose.difficulty && (
              <View style={[styles.difficultyBadge, { backgroundColor: colors.success + '22' }]}>
                <Text style={[styles.difficultyBadgeText, { color: colors.success }]}>
                  {pose.difficulty.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {pose.description ? (
            <Text style={[styles.descriptionText, { color: colors.secondaryText }]}>{pose.description}</Text>
          ) : (
            <Text style={[styles.descriptionText, { color: colors.secondaryText }]}>
              Recreate this signature look in AR Try-On mode to see how the garment fits your posture.
            </Text>
          )}
        </View>

        {/* Linked Products Section */}
        <View style={styles.productsSection}>
          <Text style={[styles.productsSectionTitle, { color: colors.text }]}>👗 Featured Garments in this Look</Text>
          <Text style={[styles.productsSectionSub, { color: colors.secondaryText }]}>
            Reserve any item from this styled look directly below
          </Text>

          {products.length > 0 ? (
            <View style={styles.productsList}>
              {products.map((prod) => (
                <TouchableOpacity
                  key={prod.id}
                  style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => router.push(`/product/${prod.id}` as any)}
                >
                  {prod.image_url ? (
                    <Image source={{ uri: prod.image_url }} style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]} />
                  ) : (
                    <View style={[styles.productImagePlaceholder, { backgroundColor: colors.imagePlaceholder }]}>
                      <Text style={{ fontSize: 20 }}>👔</Text>
                    </View>
                  )}

                  <View style={styles.productInfo}>
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
                      {prod.name}
                    </Text>
                    <Text style={[styles.productCategory, { color: colors.secondaryText }]}>{prod.category || 'Apparel'}</Text>
                    <Text style={[styles.productPrice, { color: colors.tint }]}>
                      ₱{(prod.rental_price || prod.price || 0).toLocaleString()} / day
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.reserveBtn, { backgroundColor: colors.tint }]}
                    onPress={() => router.push(`/reserve/${prod.id}` as any)}
                  >
                    <Text style={[styles.reserveBtnText, { color: colors.onTint }]}>Reserve</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={[styles.noProductsBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.noProductsText, { color: colors.secondaryText }]}>No specific products linked to this pose.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Bottom CTA Bar */}
      {products.length > 0 && (
        <View style={[styles.bottomBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <TouchableOpacity style={[styles.ctaButton, { backgroundColor: colors.tint, shadowColor: colors.tint }]} activeOpacity={0.88} onPress={handleTryInAR}>
            <IconSymbol name="sparkles" size={20} color={colors.onTint} />
            <Text style={[styles.ctaButtonText, { color: colors.onTint }]}>Try This Look in AR</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  errorText: {
    ...Typography.body,
    marginBottom: Spacing.md,
  },
  backBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  backBtnText: {
    fontWeight: '700',
  },
  navBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
  },
  navBackBtn: {
    padding: 8,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  heroImageContainer: {
    width: '100%',
    height: 380,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOccasionBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    // Fixed dark scrim regardless of theme -- this sits directly on top of a
    // photo, not a themed surface, so it needs to read against any image.
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  heroOccasionText: {
    // Fixed amber-on-dark-scrim, same reasoning as the badge background above.
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
  },
  infoCard: {
    marginHorizontal: Spacing.lg,
    marginTop: -24,
    borderRadius: 16,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  poseTitle: {
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
  },
  difficultyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  difficultyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  productsSection: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  productsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  productsSectionSub: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  productsList: {
    gap: Spacing.sm,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  productImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
  },
  productCategory: {
    fontSize: 11,
    marginTop: 2,
  },
  productPrice: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  reserveBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: 8,
  },
  reserveBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  noProductsBox: {
    padding: Spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
  },
  noProductsText: {
    fontSize: 13,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
  },
  ctaButton: {
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
