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
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { getCompleteTheLook, CompleteTheLookItem } from "@/src/services/completeTheLookService";
import { CompleteTheLookSheet } from "@/src/components/CompleteTheLookSheet";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface Props {
  currentProduct: { id: string };
}

/**
 * Teaser row on the product detail page: a preview of the Complete the Look
 * hierarchy (Curated -> Styled Look Siblings -> Algorithmic, see
 * completeTheLookService.ts). Tapping any card opens the full shoppable
 * CompleteTheLookSheet rather than navigating away, since this is meant to
 * be an in-context commerce flow, not a link-out.
 */
export default function CompleteTheLookSection({ currentProduct }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [items, setItems] = useState<CompleteTheLookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const results = await getCompleteTheLook(currentProduct.id, 5);
        if (active) setItems(results);
      } catch (err) {
        console.error("Error loading Complete the Look:", err);
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (currentProduct?.id) load();
    return () => { active = false; };
  }, [currentProduct?.id]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.tint} />
      </View>
    );
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.headerRow}
        onPress={() => setSheetVisible(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open Complete the Look"
      >
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>✨ Complete the Look</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Pieces that pair well with this item</Text>
        </View>
        <IconSymbol name="chevron.right" size={18} color={colors.icon} />
      </TouchableOpacity>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item.product.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setSheetVisible(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`${item.product.name}, view in Complete the Look`}
          >
            <Image
              source={item.product.image_url ? { uri: item.product.image_url } : undefined}
              style={[styles.image, { backgroundColor: colors.imagePlaceholder }]}
              resizeMode="cover"
            />
            <View style={styles.cardContent}>
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

      <CompleteTheLookSheet
        productId={currentProduct.id}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
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
    alignItems: "center",
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
    marginTop: 2,
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
  },
  cardContent: {
    padding: 8,
    gap: 4,
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
