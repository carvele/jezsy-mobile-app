import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing, Type as Typography } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSafeBack } from '@/src/hooks/useSafeBack';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
    if (!pose) return;
    // Route to AR screen for the first linked product, or fallback product
    const targetProductId = products.length > 0 ? products[0].id : 'P-001';
    router.push({
      pathname: `/ar-tryon/${targetProductId}` as any,
      params: { stylePoseId: pose.id },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </SafeAreaView>
    );
  }

  if (!pose) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Text style={styles.errorText}>Style pose not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navBackBtn} onPress={goBack}>
          <IconSymbol name="chevron.left" size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          {pose.name}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Styled Reference Photo */}
        <View style={styles.heroImageContainer}>
          {pose.image_url ? (
            <Image
              source={{ uri: pose.image_url }}
              style={styles.heroImage}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <IconSymbol name="camera.fill" size={64} color="#94A3B8" />
            </View>
          )}

          {pose.occasion && (
            <View style={styles.heroOccasionBadge}>
              <Text style={styles.heroOccasionText}>{pose.occasion}</Text>
            </View>
          )}
        </View>

        {/* Pose Meta Card */}
        <View style={styles.infoCard}>
          <View style={styles.titleRow}>
            <Text style={styles.poseTitle}>{pose.name}</Text>
            {pose.difficulty && (
              <View style={styles.difficultyBadge}>
                <Text style={styles.difficultyBadgeText}>
                  {pose.difficulty.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {pose.description ? (
            <Text style={styles.descriptionText}>{pose.description}</Text>
          ) : (
            <Text style={styles.descriptionText}>
              Recreate this signature look in AR Try-On mode to see how the garment fits your posture.
            </Text>
          )}
        </View>

        {/* Linked Products Section */}
        <View style={styles.productsSection}>
          <Text style={styles.productsSectionTitle}>👗 Featured Garments in this Look</Text>
          <Text style={styles.productsSectionSub}>
            Reserve any item from this styled look directly below
          </Text>

          {products.length > 0 ? (
            <View style={styles.productsList}>
              {products.map((prod) => (
                <TouchableOpacity
                  key={prod.id}
                  style={styles.productCard}
                  onPress={() => router.push(`/product/${prod.id}` as any)}
                >
                  {prod.image_url ? (
                    <Image source={{ uri: prod.image_url }} style={styles.productImage} />
                  ) : (
                    <View style={styles.productImagePlaceholder}>
                      <Text style={{ fontSize: 20 }}>👔</Text>
                    </View>
                  )}

                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={1}>
                      {prod.name}
                    </Text>
                    <Text style={styles.productCategory}>{prod.category || 'Apparel'}</Text>
                    <Text style={styles.productPrice}>
                      ₱{(prod.rental_price || prod.price || 0).toLocaleString()} / day
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.reserveBtn}
                    onPress={() => router.push(`/reserve/${prod.id}` as any)}
                  >
                    <Text style={styles.reserveBtnText}>Reserve</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.noProductsBox}>
              <Text style={styles.noProductsText}>No specific products linked to this pose.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Bottom CTA Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.ctaButton} activeOpacity={0.88} onPress={handleTryInAR}>
          <IconSymbol name="sparkles" size={20} color="#FFFFFF" />
          <Text style={styles.ctaButtonText}>Try This Look in AR</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  errorText: {
    ...Typography.body,
    color: '#EF4444',
    marginBottom: Spacing.md,
  },
  backBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  navBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  navBackBtn: {
    padding: 8,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  heroImageContainer: {
    width: '100%',
    height: 380,
    backgroundColor: '#0F172A',
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  heroOccasionText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
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
    color: Colors.light.text,
    flex: 1,
  },
  difficultyBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  difficultyBadgeText: {
    color: '#059669',
    fontSize: 10,
    fontWeight: '800',
  },
  descriptionText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  productsSection: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  productsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  productsSectionSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  productsList: {
    gap: Spacing.sm,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  productImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
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
    color: Colors.light.text,
  },
  productCategory: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  productPrice: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.tint,
    marginTop: 4,
  },
  reserveBtn: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: 8,
  },
  reserveBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  noProductsBox: {
    padding: Spacing.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
  },
  noProductsText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  ctaButton: {
    backgroundColor: Colors.light.tint,
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.light.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
