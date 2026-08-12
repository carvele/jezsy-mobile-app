import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { recommendCompleteTheLook, CatalogItem, LookRecommendation } from "@/src/utils/completeTheLook";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface Props {
  currentProduct: CatalogItem;
}

export default function CompleteTheLookSection({ currentProduct }: Props) {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [recommendations, setRecommendations] = useState<LookRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCatalogAndScore() {
      try {
        setLoading(true);
        // RelatedProducts.tsx (the sibling recommendation component) filters
        // deleted/visibility explicitly rather than relying on RLS alone --
        // matching that here closes the one case RLS doesn't cover: a
        // staff/owner account browsing the mobile app would otherwise get
        // deleted or non-public products recommended, since
        // is_staff_or_admin() bypasses the customer-facing RLS policy.
        const { data, error } = await supabase
          .from("products")
          .select("id, name, category, category_id, color, price, sale_price, on_sale, image_url")
          .eq("deleted", false)
          .eq("visibility", "public")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        if (data && currentProduct) {
          const scored = recommendCompleteTheLook(currentProduct, data as CatalogItem[], 5);
          setRecommendations(scored);
        }
      } catch (err) {
        console.error("Error generating Complete the Look recommendations:", err);
      } finally {
        setLoading(false);
      }
    }

    if (currentProduct?.id) {
      loadCatalogAndScore();
    }
  }, [currentProduct?.id]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.tint} />
      </View>
    );
  }

  if (recommendations.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>✨ Complete the Look</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>AI Stylist Matches</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}
      >
        {recommendations.map((item) => (
          <TouchableOpacity
            key={item.product.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/product/${item.product.id}`)}
            activeOpacity={0.8}
          >
            <Image source={{ uri: item.product.image_url }} style={styles.image} />
            <View style={styles.cardContent}>
              <View style={[styles.harmonyBadge, { backgroundColor: colors.tint + "20" }]}>
                <IconSymbol name="sparkles" size={12} color={colors.tint} />
                <Text style={[styles.harmonyText, { color: colors.tint }]}>
                  {item.harmony.label}
                </Text>
              </View>

              <Text style={[styles.productTitle, { color: colors.text }]} numberOfLines={1}>
                {item.product.name}
              </Text>

              <Text style={[styles.priceText, { color: colors.tint }]}>
                ₱{(item.product.sale_price || item.product.price || 0).toFixed(2)}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  loadingContainer: {
    padding: 16,
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
  },
  scrollList: {
    gap: 12,
  },
  card: {
    width: 140,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  image: {
    width: 140,
    height: 160,
    backgroundColor: "#2a2a30",
    resizeMode: "cover",
  },
  cardContent: {
    padding: 8,
    gap: 4,
  },
  harmonyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  harmonyText: {
    fontSize: 10,
    fontWeight: "600",
  },
  productTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  priceText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
