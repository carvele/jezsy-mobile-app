import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ReviewsList } from "@/src/components/ReviewsList";
import { useAuth } from "@/src/context/AuthContext";
import { useCart } from "@/src/context/CartContext";
import { useWishlist } from "@/src/context/WishlistContext";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/types/database.types";
import { recommendSize } from "@/src/utils/sizeRecommender";

type Product = Database["public"]["Tables"]["products"]["Row"];

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const { user } = useAuth();
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [addedToBag, setAddedToBag] = useState(false);

  const router = useRouter();
  const theme = useColorScheme() ?? "light";
  const colors = Colors[theme];
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { addToCart } = useCart();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .single();

        if (error) {
          console.error("Error fetching product:", error);
        } else if (data) {
          setProduct(data);
          // Default selection
          if (data.sizes && data.sizes.length > 0)
            setSelectedSize(data.sizes[0]);
          if (data.color) setSelectedColor(data.color.split(",")[0].trim()); // Assuming comma-separated colors

          // Compute size recommendation if user is logged in and product has measurements
          if (user?.id && data.measurements) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("fit_preference")
              .eq("id", user.id)
              .single();
            const { data: metrics } = await supabase
              .from("user_measurements")
              .select("measurements")
              .eq("user_id", user.id)
              .maybeSingle();

            if (metrics && metrics.measurements) {
              const rec = recommendSize(
                metrics.measurements as any,
                data.measurements as any,
                profile?.fit_preference || "regular",
              );
              setRecommendedSize(rec);
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id, user?.id]);

  if (loading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!product) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 20 }}
        >
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Parse colors if stored as comma-separated string
  const colorsList = product.color
    ? product.color.split(",").map((c) => c.trim())
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.imageContainer}>
          <Image
            source={
              product.image_url
                ? { uri: product.image_url }
                : require("@/assets/images/partial-react-logo.png")
            }
            style={styles.image}
            contentFit="cover"
          />
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: "rgba(0,0,0,0.5)" }]}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen"
          >
            <IconSymbol name="chevron.left" size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.favoriteButton,
              { backgroundColor: "rgba(0,0,0,0.5)" },
            ]}
            onPress={() => toggleWishlist(product.id)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={isInWishlist(product.id) ? 'Remove from wishlist' : 'Add to wishlist'}
            accessibilityHint={isInWishlist(product.id) ? 'Removes this product from your saved items' : 'Saves this product to your wishlist'}
            accessibilityState={{ selected: isInWishlist(product.id) }}
          >
            <IconSymbol
              name={isInWishlist(product.id) ? "heart.fill" : "heart"}
              size={24}
              color={isInWishlist(product.id) ? "#E05C5C" : "#FFF"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.arButton,
              { backgroundColor: "rgba(201,169,110,0.9)" },
            ]}
            onPress={() => router.push(`/ar-tryon/${product.id}`)}
            accessibilityRole="button"
            accessibilityLabel="Try in AR"
            accessibilityHint="Opens the augmented reality try-on experience"
          >
            <IconSymbol name="cube.transparent" size={24} color="#0D0D0D" />
            <Text style={styles.arButtonText}>Try in AR</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              {product.name}
            </Text>
            <Text style={[styles.price, { color: colors.tint }]}>
              ₱{(product.price || 0).toFixed(2)}
            </Text>
          </View>

          <Text style={[styles.category, { color: colors.secondaryText }]}>
            {product.category?.toUpperCase()}
          </Text>

          {/* Description */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Description
            </Text>
            <Text style={[styles.description, { color: colors.secondaryText }]}>
              {product.description ||
                "No description available for this premium piece."}
            </Text>
          </View>

          {/* Color Selection */}
          {colorsList.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Color
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.optionsList}
              >
                {colorsList.map((c, index) => {
                  const isSelected = selectedColor === c;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.optionButton,
                        {
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                        isSelected && { backgroundColor: colors.card },
                      ]}
                      onPress={() => setSelectedColor(c)}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          { color: isSelected ? colors.tint : colors.text },
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Size Selection */}
          {product.sizes && product.sizes.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sizeHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Size
                </Text>
                {recommendedSize && (
                  <View
                    style={[
                      styles.recBadge,
                      { backgroundColor: colors.tint + "20" },
                    ]}
                  >
                    <IconSymbol
                      name="ruler.fill"
                      size={12}
                      color={colors.tint}
                    />
                    <Text style={[styles.recText, { color: colors.tint }]}>
                      Recommended: {recommendedSize}
                    </Text>
                  </View>
                )}
                <TouchableOpacity>
                  <Text style={[styles.sizeGuideText, { color: colors.tint }]}>
                    Size Guide
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.optionsList}
              >
                {product.sizes.map((s, index) => {
                  const isSelected = selectedSize === s;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.optionButton,
                        {
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                        isSelected && { backgroundColor: colors.card },
                      ]}
                      onPress={() => setSelectedSize(s)}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          { color: isSelected ? colors.tint : colors.text },
                        ]}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Customer Reviews & Ratings */}
          <ReviewsList productId={product.id} />

          {/* Spacer for sticky bottom bar */}
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.iconAction, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Add to Bag"
            accessibilityHint="Adds the selected item to your shopping bag"
            onPress={() => {
              if (product) {
                addToCart(
                  product,
                  1,
                  selectedSize || undefined,
                  selectedColor || undefined,
                );
                setAddedToBag(true);
                setTimeout(() => setAddedToBag(false), 2000);
              }
            }}
          >
            <IconSymbol name="bag.badge.plus" size={24} color={colors.text} />
          </TouchableOpacity>

          {addedToBag && (
            <View style={[styles.addedToast, { backgroundColor: colors.tint }]}>
              <IconSymbol name="checkmark" size={14} color="#0D0D0D" />
              <Text style={styles.addedToastText}>Added to Bag!</Text>
            </View>
          )}

          {/** Primary action gating: require size + color if available **/}
          {(() => {
            const needsSize = !!(product?.sizes && product.sizes.length > 0);
            const needsColor = !!product?.color;
            const canReserve =
              (!needsSize || !!selectedSize) &&
              (!needsColor || !!selectedColor);

            return (
              <TouchableOpacity
                style={[
                  styles.primaryAction,
                  {
                    backgroundColor: canReserve ? colors.tint : colors.border,
                    opacity: canReserve ? 1 : 0.7,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Reserve Now"
                accessibilityHint={
                  canReserve
                    ? "Confirms your reservation"
                    : "Select size and color to enable reservation"
                }
                accessibilityState={{ disabled: !canReserve }}
                onPress={() => {
                  if (product && canReserve) {
                    router.push({
                      pathname: "/reserve/[id]",
                      params: {
                        id: product.id,
                        size: selectedSize || "",
                        color: selectedColor || "",
                      },
                    });
                  }
                }}
                disabled={!canReserve}
              >
                <Text style={styles.primaryActionText}>Reserve Now</Text>
              </TouchableOpacity>
            );
          })()}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  imageContainer: {
    width: "100%",
    height: 500,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "#2A2A2A",
  },
  backButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  favoriteButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  arButton: {
    position: "absolute",
    bottom: 50,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  arButtonText: {
    color: "#0D0D0D",
    fontWeight: "700",
    fontSize: 14,
  },
  contentContainer: {
    padding: 24,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -30,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: "800",
    marginRight: 16,
  },
  price: {
    fontSize: 24,
    fontWeight: "800",
  },
  category: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 24,
  },
  section: {
    marginTop: 24,
  },
  sizeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  recText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
  },
  optionsList: {
    gap: 12,
    paddingRight: 20,
  },
  optionButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  optionText: {
    fontSize: 15,
    fontWeight: "600",
  },
  sizeGuideText: {
    fontSize: 14,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: Platform.OS === "ios" ? 32 : 20,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  actionButtons: {
    flexDirection: "row",
    flex: 1,
    gap: 16,
  },
  iconAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryAction: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#C9A96E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryActionText: {
    color: "#0D0D0D", // Dark text on gold
    fontSize: 18,
    fontWeight: "700",
  },
  addedToast: {
    position: 'absolute',
    top: -40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addedToastText: {
    color: '#0D0D0D',
    fontWeight: '700',
    fontSize: 14,
  },
});
