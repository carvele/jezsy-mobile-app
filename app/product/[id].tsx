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
  Dimensions,
  FlatList,
  Image as RNImage,
} from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ReviewsList } from "@/src/components/ReviewsList";
import { RelatedProducts } from "@/src/components/RelatedProducts";
import { useAuth } from "@/src/context/AuthContext";
import { useCart } from "@/src/context/CartContext";
import { useWishlist } from "@/src/context/WishlistContext";
import { useMessages } from "@/src/context/MessagesContext";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/types/database.types";
import { CATEGORY_SELECT, getMainCategoryId, getMainCategoryName, WithCategoryEmbed } from "@/src/utils/categoryDisplay";
import { recommendSize } from "@/src/utils/sizeRecommender";

type Product = Database["public"]["Tables"]["products"]["Row"] & WithCategoryEmbed;
type Inventory = Database["public"]["Tables"]["inventory"]["Row"];

const { width } = Dimensions.get("window");

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const { user } = useAuth();
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [addedToBag, setAddedToBag] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);

  const router = useRouter();
  const theme = useColorScheme() ?? "light";
  const colors = Colors[theme];
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { addToCart } = useCart();
  const { getOrCreateConversation } = useMessages();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  useEffect(() => {
    const fetchProductAndInventory = async () => {
      try {
        const [productRes, invRes] = await Promise.all([
          supabase.from("products").select(`*, ${CATEGORY_SELECT}`).eq("id", id).single(),
          supabase.from("inventory").select("*").eq("product_doc_id", id)
        ]);

        if (productRes.error) {
          console.error("Error fetching product:", productRes.error);
        } else if (productRes.data) {
          const data = productRes.data;
          setProduct(data);
          
          if (invRes.data) {
            setInventory(invRes.data);
          }

          // Default selections
          if (data.sizes && data.sizes.length > 0) {
            // Find first available size or just default to first
            const availableSize = data.sizes.find(s => {
              const inv = invRes.data?.find(i => i.size === s);
              return !inv || (inv.available || 0) > 0;
            });
            setSelectedSize(availableSize || data.sizes[0]);
          }
          if (data.color) setSelectedColor(data.color.split(",")[0].trim());

          // Compute size recommendation if user is logged in
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

    fetchProductAndInventory();
  }, [id, user?.id]);

  const handleMessageSeller = async () => {
    const conv = await getOrCreateConversation();
    if (conv) {
      router.push(`/messages/${conv.id}` as any);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const colorsList = product.color ? product.color.split(",").map((c) => c.trim()) : [];
  
  // Combine images array with primary image_url if not in array
  const imageGallery = product.images && product.images.length > 0 
    ? product.images 
    : (product.image_url ? [product.image_url] : []);
    
  if (imageGallery.length === 0) {
    imageGallery.push(RNImage.resolveAssetSource(require("@/assets/images/partial-react-logo.png")).uri);
  }

  const getStockInfo = (size: string) => {
    const inv = inventory.find(i => i.size === size);
    if (!inv) return null; // Fallback to assumed available if no tracking
    return inv.available || 0;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        {/* Image Gallery */}
        <View style={styles.imageContainer}>
          <FlatList
            data={imageGallery}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / width);
              setActiveImageIndex(index);
            }}
            renderItem={({ item }) => (
              <Image source={{ uri: item }} style={{ width, height: 500 }} contentFit="cover" />
            )}
            keyExtractor={(item, index) => index.toString()}
          />
          
          {/* Pagination Dots */}
          {imageGallery.length > 1 && (
            <View style={styles.pagination}>
              {imageGallery.map((_, i) => (
                <View key={i} style={[styles.dot, i === activeImageIndex && styles.dotActive]} />
              ))}
            </View>
          )}

          {/* Top Floating Buttons */}
          <TouchableOpacity 
            style={[styles.backButton, { backgroundColor: "rgba(0,0,0,0.5)" }]} 
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen"
          >
            <IconSymbol name="chevron.left" size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.favoriteButton, { backgroundColor: "rgba(0,0,0,0.5)" }]}
            onPress={() => toggleWishlist(product.id)}
            accessibilityRole="button"
            accessibilityLabel={isInWishlist(product.id) ? "Remove from wishlist" : "Add to wishlist"}
            accessibilityHint={isInWishlist(product.id) ? "Removes this item from your favorites list" : "Saves this item to your favorites list"}
          >
            <IconSymbol name={isInWishlist(product.id) ? "heart.fill" : "heart"} size={24} color={isInWishlist(product.id) ? "#E05C5C" : "#FFF"} />
          </TouchableOpacity>
          {product.model_3d_url && (
            <TouchableOpacity
              style={[styles.arButton, { backgroundColor: "rgba(201,169,110,0.9)" }]}
              onPress={() => router.push(`/ar-tryon/${product.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Try on in Augmented Reality"
              accessibilityHint="Launches the AR viewer to see this clothing item on your camera feed"
            >
              <IconSymbol name="cube.transparent" size={24} color="#0D0D0D" />
              <Text style={styles.arButtonText}>Try in AR</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>{product.name}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              {product.on_sale && product.sale_price ? (
                <>
                  <Text style={[styles.priceOriginal, { color: colors.secondaryText }]}>₱{(product.price || 0).toFixed(2)}</Text>
                  <Text style={[styles.priceSale, { color: colors.tint }]}>₱{(product.sale_price || 0).toFixed(2)}</Text>
                  {product.discount_percentage && (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountText}>{product.discount_percentage}% OFF</Text>
                    </View>
                  )}
                </>
              ) : (
                <Text style={[styles.price, { color: colors.tint }]}>₱{(product.price || 0).toFixed(2)}</Text>
              )}
            </View>
          </View>

          <Text style={[styles.category, { color: colors.secondaryText }]}>
            {getMainCategoryName(product)?.toUpperCase()}
          </Text>

          {/* Message Seller Button */}
          <TouchableOpacity
            style={[styles.messageButton, { borderColor: colors.tint }]}
            onPress={handleMessageSeller}
            accessibilityRole="button"
            accessibilityLabel="Ask the shop owner a question about this item"
          >
            <IconSymbol name="envelope.fill" size={20} color={colors.tint} />
            <Text style={[styles.messageButtonText, { color: colors.tint }]}>Ask a Question about this item</Text>
          </TouchableOpacity>

          {/* Description */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Description</Text>
            <Text 
              style={[styles.description, { color: colors.secondaryText }]}
              numberOfLines={descExpanded ? undefined : 3}
            >
              {product.description || "No description available for this premium piece."}
            </Text>
            {product.description && product.description.length > 100 && (
              <TouchableOpacity onPress={() => setDescExpanded(!descExpanded)} style={{ marginTop: 8 }}>
                <Text style={{ color: colors.tint, fontWeight: '600' }}>{descExpanded ? 'Read less' : 'Read more'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Color Selection */}
          {colorsList.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsList}>
                {colorsList.map((c, index) => {
                  const isSelected = selectedColor === c;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.optionButton,
                        { borderColor: isSelected ? colors.tint : colors.border },
                        isSelected && { backgroundColor: colors.card },
                      ]}
                      onPress={() => setSelectedColor(c)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select color ${c}`}
                      accessibilityHint={`Selects ${c} as the color option`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.optionText, { color: isSelected ? colors.tint : colors.text }]}>{c}</Text>
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
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Size</Text>
                {recommendedSize && (
                  <View style={[styles.recBadge, { backgroundColor: colors.tint + "20" }]}>
                    <IconSymbol name="ruler.fill" size={12} color={colors.tint} />
                    <Text style={[styles.recText, { color: colors.tint }]}>Recommended: {recommendedSize}</Text>
                  </View>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsList}>
                {product.sizes.map((s, index) => {
                  const isSelected = selectedSize === s;
                  const stock = getStockInfo(s);
                  const isOutOfStock = stock !== null && stock <= 0;
                  
                  return (
                    <View key={index} style={{ alignItems: 'center' }}>
                      <TouchableOpacity
                        style={[
                          styles.optionButton,
                          { borderColor: isSelected ? colors.tint : colors.border },
                          isSelected && { backgroundColor: colors.card },
                          isOutOfStock && { opacity: 0.4 }
                        ]}
                        onPress={() => !isOutOfStock && setSelectedSize(s)}
                        disabled={isOutOfStock}
                        accessibilityRole="button"
                        accessibilityLabel={`Select size ${s}`}
                        accessibilityHint={isOutOfStock ? `Size ${s} is out of stock` : `Selects ${s} as the size option`}
                        accessibilityState={{ selected: isSelected, disabled: isOutOfStock }}
                      >
                        <Text style={[styles.optionText, { color: isSelected ? colors.tint : colors.text }]}>{s}</Text>
                      </TouchableOpacity>
                      {stock !== null && stock > 0 && stock <= 5 && (
                        <Text style={{ fontSize: 10, color: '#E05C5C', marginTop: 4 }}>Only {stock} left</Text>
                      )}
                      {isOutOfStock && (
                        <Text style={{ fontSize: 10, color: colors.secondaryText, marginTop: 4 }}>Out of stock</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Product Details (Material & Care) */}
          {(product.material || product.care_instructions || product.fit_and_sizing) && (
            <View style={[styles.section, styles.detailsSection, { borderColor: colors.border }]}>
              {product.material && (
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.text }]}>Material</Text>
                  <Text style={[styles.detailValue, { color: colors.secondaryText }]}>{product.material}</Text>
                </View>
              )}
              {product.fit_and_sizing && (
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.text }]}>Fit</Text>
                  <Text style={[styles.detailValue, { color: colors.secondaryText }]}>{product.fit_and_sizing}</Text>
                </View>
              )}
              {product.care_instructions && (
                <View style={[styles.detailRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                  <Text style={[styles.detailLabel, { color: colors.text }]}>Care</Text>
                  <Text style={[styles.detailValue, { color: colors.secondaryText }]}>{product.care_instructions}</Text>
                </View>
              )}
            </View>
          )}

          {/* Customer Reviews & Ratings */}
          <ReviewsList productId={product.id} />

          {/* Related Products */}
          {getMainCategoryId(product) && (
            <RelatedProducts mainCategoryId={getMainCategoryId(product)} currentProductId={product.id} />
          )}

          {/* Spacer for sticky bottom bar */}
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.iconAction, { borderColor: colors.border }]}
            onPress={() => {
              if (product) {
                addToCart(product, 1, selectedSize || undefined, selectedColor || undefined);
                setAddedToBag(true);
                setTimeout(() => setAddedToBag(false), 2000);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Add to shopping bag"
            accessibilityHint="Adds the selected size and color of this item to your cart"
          >
            <IconSymbol name="bag.badge.plus" size={24} color={colors.text} />
          </TouchableOpacity>

          {addedToBag && (
            <View style={[styles.addedToast, { backgroundColor: colors.tint }]}>
              <IconSymbol name="checkmark" size={14} color="#0D0D0D" />
              <Text style={styles.addedToastText}>Added to Bag!</Text>
            </View>
          )}

          {(() => {
            const needsSize = !!(product?.sizes && product.sizes.length > 0);
            const needsColor = !!product?.color;
            const canReserve = (!needsSize || !!selectedSize) && (!needsColor || !!selectedColor);

            return (
              <TouchableOpacity
                style={[styles.primaryAction, {
                  backgroundColor: canReserve ? colors.tint : colors.border,
                  opacity: canReserve ? 1 : 0.7,
                }]}
                onPress={() => {
                  if (product && canReserve) {
                    router.push({
                      pathname: "/reserve/[id]",
                      params: { id: product.id, size: selectedSize || "", color: selectedColor || "" },
                    });
                  }
                }}
                disabled={!canReserve}
                accessibilityRole="button"
                accessibilityLabel="Reserve Now"
                accessibilityHint={canReserve ? "Starts the reservation process for this item" : "Choose a size and color to enable reservation"}
                accessibilityState={{ disabled: !canReserve }}
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
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  imageContainer: { width: "100%", height: 500, position: "relative" },
  pagination: {
    position: 'absolute',
    bottom: 30,
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#FFF',
    width: 24,
  },
  backButton: {
    position: "absolute", top: Platform.OS === "ios" ? 60 : 40, left: 20,
    width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center",
  },
  favoriteButton: {
    position: "absolute", top: Platform.OS === "ios" ? 60 : 40, right: 20,
    width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center",
  },
  arButton: {
    position: "absolute", bottom: 60, right: 20, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, gap: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  arButtonText: { color: "#0D0D0D", fontWeight: "700", fontSize: 14 },
  contentContainer: { padding: 24, borderTopLeftRadius: 30, borderTopRightRadius: 30, marginTop: -30 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  title: { flex: 1, fontSize: 26, fontWeight: "800", marginRight: 16 },
  price: { fontSize: 24, fontWeight: "800" },
  priceOriginal: { fontSize: 16, textDecorationLine: 'line-through', fontWeight: '500' },
  priceSale: { fontSize: 24, fontWeight: "800" },
  discountBadge: { backgroundColor: '#E05C5C', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  discountText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  category: { fontSize: 14, fontWeight: "600", letterSpacing: 1, marginBottom: 24 },
  section: { marginTop: 24 },
  sizeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  recBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4 },
  recText: { fontSize: 12, fontWeight: "700" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  description: { fontSize: 15, lineHeight: 24 },
  optionsList: { gap: 12, paddingRight: 20 },
  optionButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  optionText: { fontSize: 15, fontWeight: "600" },
  detailsSection: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 32,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  detailValue: {
    flex: 2,
    fontSize: 15,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 1,
    borderRadius: 24,
    marginTop: 24,
    gap: 8,
  },
  messageButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingVertical: Platform.OS === "ios" ? 32 : 20,
    borderTopWidth: 1, flexDirection: "row", alignItems: "center",
  },
  actionButtons: { flexDirection: "row", flex: 1, gap: 16 },
  iconAction: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  primaryAction: {
    flex: 1, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center",
    shadowColor: "#C9A96E", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  primaryActionText: { color: "#0D0D0D", fontSize: 18, fontWeight: "700" },
  addedToast: {
    position: 'absolute', top: -40, left: 0, right: 0, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 20,
  },
  addedToastText: { color: '#0D0D0D', fontWeight: '700', fontSize: 14 },
});
