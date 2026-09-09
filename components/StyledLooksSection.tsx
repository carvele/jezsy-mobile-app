import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, Spacing } from '@/constants/theme';
import { ProductCard } from '@/src/components/ProductCard';
import type { Database } from '@/src/types/database.types';

type Product = Database['public']['Tables']['products']['Row'];

interface StyledLook {
  id: string;
  name: string;
  imageUrl: string | null;
  category: string | null;
  occasion: string | null;
  products: Product[];
}

interface Props {
  currentProduct: { id: string };
}

// Real curated "as styled by us" content (pose_guides), distinct from
// CompleteTheLookSection's AI category/color-matching heuristic over the
// whole catalog -- this shows only looks a stylist actually assembled and
// linked this product into.
export function StyledLooksSection({ currentProduct }: Props) {
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const [looks, setLooks] = useState<StyledLook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadStyledLooks = async () => {
      try {
        setLoading(true);
        const { data: poseRows, error: poseError } = await supabase
          .rpc('get_pose_guides_for_product', { p_product_id: currentProduct.id });

        if (poseError) throw poseError;
        if (!poseRows || poseRows.length === 0) {
          if (active) setLooks([]);
          return;
        }

        const poseIds = poseRows.map((p) => p.id);

        // One batched query for every returned look's products, instead of
        // querying pose_guide_products once per look.
        const { data: junctionRows, error: junctionError } = await supabase
          .from('pose_guide_products')
          .select('pose_guide_id, product_id, product:products(*)')
          .in('pose_guide_id', poseIds);

        if (junctionError) throw junctionError;

        const productsByPose = new Map<string, Product[]>();
        for (const row of junctionRows || []) {
          const product = row.product as unknown as Product | null;
          if (!product || product.id === currentProduct.id) continue;
          const list = productsByPose.get(row.pose_guide_id) || [];
          list.push(product);
          productsByPose.set(row.pose_guide_id, list);
        }

        const built: StyledLook[] = poseRows
          .map((pose) => ({
            id: pose.id,
            name: pose.name,
            imageUrl: pose.image_url,
            category: pose.category,
            occasion: pose.occasion,
            products: productsByPose.get(pose.id) || [],
          }))
          // A look whose only linked product is the current one has nothing
          // else to show -- skip it rather than render an empty rail.
          .filter((look) => look.products.length > 0);

        if (active) setLooks(built);
      } catch (err) {
        console.error('Error loading styled looks:', err);
        if (active) setLooks([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    if (currentProduct?.id) {
      loadStyledLooks();
    }
    return () => { active = false; };
  }, [currentProduct?.id]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.tint} />
      </View>
    );
  }

  if (looks.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Styled Looks</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>As seen in these outfits</Text>
      </View>

      {looks.map((look) => (
        <View key={look.id} style={styles.lookBlock}>
          <TouchableOpacity
            style={styles.lookHeader}
            activeOpacity={0.85}
            onPress={() => router.push(`/style-pose/${look.id}` as any)}
          >
            {look.imageUrl ? (
              <Image source={{ uri: look.imageUrl }} style={styles.lookImage} contentFit="cover" />
            ) : null}
            <View style={styles.lookTextWrap}>
              <Text style={[styles.lookName, { color: colors.text }]} numberOfLines={1}>{look.name}</Text>
              {look.occasion ? (
                <Text style={[styles.lookMeta, { color: colors.secondaryText }]}>{look.occasion}</Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRail}>
            {look.products.map((product) => (
              <ProductCard key={product.id} product={product} variant="rail" />
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    marginVertical: Spacing.md,
  },
  loadingContainer: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  headerRow: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  lookBlock: {
    marginBottom: Spacing.lg,
  },
  lookHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  lookImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  lookTextWrap: {
    flex: 1,
  },
  lookName: {
    fontSize: 14,
    fontWeight: '700',
  },
  lookMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  productRail: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
});
