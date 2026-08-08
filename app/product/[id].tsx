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
  Share,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Radius, Spacing, Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ReviewsList } from "@/src/components/ReviewsList";
import { RelatedProducts } from "@/src/components/RelatedProducts";
import { RecentlyViewed } from "@/src/components/RecentlyViewed";
import { addRecentlyViewed } from "@/src/utils/recentlyViewed";
import { useAuth } from "@/src/context/AuthContext";
import { useCart } from "@/src/context/CartContext";
import { useWishlist } from "@/src/context/WishlistContext";
import { useMessages } from "@/src/context/MessagesContext";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/types/database.types";
import { CATEGORY_SELECT, getMainCategoryId, getMainCategoryName, WithCategoryEmbed } from "@/src/utils/categoryDisplay";
import { recommendSize, ProductMeasurements } from "@/src/utils/sizeRecommender";
import { SizeChartModal } from "@/src/components/SizeChartModal";
import { ImageViewerModal } from "@/src/components/ImageViewerModal";
import { useToast } from '@/src/context/ToastContext';

type Product = Database["public"]["Tables"]["products"]["Row"] & WithCategoryEmbed;
type Inventory = Database["public"]["Tables"]["inventory"]["Row"];

const { width } = Dimensions.get("window");

export default function ProductDetailScreen() {
  const { showToast } = useToast();
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
  const [quantity, setQuantity] = useState(1);
  const [notifyRequested, setNotifyRequested] = useState(false);
  const [notifySubmitting, setNotifySubmitting] = useState(false);
  const [sizeChartVisible, setSizeChartVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  useEffect(() => {
    if (id) addRecentlyViewed(id, user?.id);
  }, [id, user?.id]);

  useEffect(() => {
    const checkNotifyRequest = async () => {
      if (!user?.id || !id || !selectedSize) {
        setNotifyRequested(false);
        return;
      }
      const { data } = await supabase
        .from("stock_notify_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("product_id", id)
        .eq("size", selectedSize)
        .maybeSingle();
      setNotifyRequested(!!data);
    };
    checkNotifyRequest();
  }, [id, user?.id, selectedSize]);

  const handleNotifyMe = async () => {
    if (!user?.id || !id || !selectedSize) {
      showToast("Log in to get notified when this size is back in stock.", 'info');
      return;
    }
    setNotifySubmitting(true);
    try {
      const { error } = await supabase
        .from("stock_notify_requests")
        .insert({ user_id: user.id, product_id: id, size: selectedSize });
      if (error && error.code !== "23505") throw error; // 23505 = already requested
      setNotifyRequested(true);
    } catch (err) {
      console.error("Error requesting stock notification:", err);
    } finally {
      setNotifySubmitting(false);
    }
  };

  const handleShare = async () => {
    if (!product) return;
    try {
      await Share.share({
        message: `Check out ${product.name} on JezSy: jezsymobileapp://product/${product.id}`,
      });
    } catch (err) {
      console.error("Error sharing product:", err);
    }
  };

  const handleMessageSeller = async () => {
    const conv = await getOrCreateConversation();
    if (!conv) return;
    router.push({
      pathname: '/messages/[conversationId]',
      params: {
        conversationId: conv.id,
        ctxType: 'product',
        ctxRef: product?.id ?? '',
        ctxLabel: product ? `${product.name}${selectedSize ? ` (Size ${selectedSize})` : ''}` : 'a product',
      },
    } as any);
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

  // Purchase gating: block Add-to-Bag and Reserve when the chosen size is
  // tracked and out of stock. The default-size logic can land on an
  // out-of-stock size (it falls back to sizes[0] when none are available),
  // so both actions must re-check stock rather than trust the selection.
  const needsSize = !!(product.sizes && product.sizes.length > 0);
  const needsColor = !!product.color;
  const selectedStock = selectedSize ? getStockInfo(selectedSize) : null;
  const selectedSizeOutOfStock = selectedStock !== null && selectedStock <= 0;
  const hasRequiredSelection =
    (!needsSize || !!selectedSize) && (!needsColor || !!selectedColor);
  const canPurchase = hasRequiredSelection && !selectedSizeOutOfStock;
  const sizeChart = (product.measurements as ProductMeasurements | null) || null;
  const hasSizeChart = !!sizeChart && (product.sizes || []).some(s => sizeChart[s]);
  const maxQuantity = selectedStock !== null ? selectedStock : 10;
  const effectiveQuantity = Math.min(Math.max(quantity, 1), Math.max(maxQuantity, 1));

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
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => setViewerUri(item)}
                accessibilityRole="button"
                accessibilityLabel="View image full screen"
                accessibilityHint="Opens a zoomable full-screen view of this product image"
              >
                <Image source={{ uri: item }} style={{ width, height: 500 }} contentFit="cover" />
              </TouchableOpacity>
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
            style={[styles.backButton, { top: insets.top + 12, backgroundColor: "rgba(0,0,0,0.5)" }]} 
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen"
          >
            <IconSymbol name="chevron.left" size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.favoriteButton, { top: insets.top + 12, backgroundColor: "rgba(0,0,0,0.5)" }]}
            onPress={() => toggleWishlist(product.id)}
            accessibilityRole="button"
            accessibilityLabel={isInWishlist(product.id) ? "Remove from wishlist" : "Add to wishlist"}
            accessibilityHint={isInWishlist(product.id) ? "Removes this item from your favorites list" : "Saves this item to your favorites list"}
          >
            <IconSymbol name={isInWishlist(product.id) ? "heart.fill" : "heart"} size={24} color={isInWishlist(product.id) ? Colors.dark.blushFill : "#FFF"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shareButton, { top: insets.top + 12, backgroundColor: "rgba(0,0,0,0.5)" }]}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share this item"
          >
            <IconSymbol name="paperplane.fill" size={22} color="#FFF" />
          </TouchableOpacity>
          {product.model_3d_url && (
            <TouchableOpacity
              style={[styles.arButton, { backgroundColor: "rgba(201,169,110,0.9)" }]}
              onPress={() => router.push(`/ar-tryon/${product.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Try on in Augmented Reality"
              accessibilityHint="Launches the AR viewer to see this clothing item on your camera feed"
            >
              <IconSymbol name="cube.transparent" size={24} color={colors.onTint} />
              <Text style={styles.arButtonText}>Try in AR</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.contentContainer}>
          {/* Category eyebrow, then name, then the figures that qualify it.
              The name is the heading; price used to be set at nearly the same
              size and weight, so the two competed for first read. */}
          <Text style={[styles.category, { color: colors.secondaryText }]}>
            {getMainCategoryName(product)?.toUpperCase()}
          </Text>

          <Text style={[styles.title, { color: colors.text }]}>{product.name}</Text>

          {product.rating && product.review_count ? (
            <View style={styles.ratingRow}>
              <IconSymbol name="star.fill" size={13} color={colors.tint} />
              <Text style={[styles.ratingValue, { color: colors.text }]}>{product.rating.toFixed(1)}</Text>
              <Text style={[styles.ratingCount, { color: colors.secondaryText }]}>
                ({product.review_count} review{product.review_count === 1 ? '' : 's'})
              </Text>
            </View>
          ) : null}

          <View style={styles.priceRow}>
            {product.on_sale && product.sale_price ? (
              <>
                <Text style={[styles.priceSale, { color: colors.tint }]}>₱{(product.sale_price || 0).toFixed(2)}</Text>
                <Text style={[styles.priceOriginal, { color: colors.secondaryText }]}>₱{(product.price || 0).toFixed(2)}</Text>
                {product.discount_percentage ? (
                  <View style={styles.discountBadge}>
                    <Text style={styles.discountText}>{product.discount_percentage}% OFF</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={[styles.price, { color: colors.tint }]}>₱{(product.price || 0).toFixed(2)}</Text>
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
                <View style={styles.sizeHeaderActions}>
                  {recommendedSize && (
                    <View style={[styles.recBadge, { backgroundColor: colors.tint + "20" }]}>
                      <IconSymbol name="ruler.fill" size={12} color={colors.tint} />
                      <Text style={[styles.recText, { color: colors.tint }]}>Recommended: {recommendedSize}</Text>
                    </View>
                  )}
                  {hasSizeChart && (
                    <TouchableOpacity
                      onPress={() => setSizeChartVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="View the size chart"
                    >
                      <Text style={[styles.sizeChartLink, { color: colors.tint }]}>Size Chart</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
                        <Text style={[Type.caption, { color: colors.warning, marginTop: Spacing.xs }]}>Only {stock} left</Text>
                      )}
                      {isOutOfStock && (
                        <Text style={[Type.caption, { color: colors.secondaryText, marginTop: Spacing.xs }]}>Out of stock</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Quantity */}
          {canPurchase && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Quantity</Text>
              <View style={styles.quantityRow}>
                <TouchableOpacity
                  style={[styles.quantityBtn, { borderColor: colors.border, opacity: effectiveQuantity <= 1 ? 0.4 : 1 }]}
                  onPress={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={effectiveQuantity <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease quantity"
                >
                  <IconSymbol name="minus" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.quantityValue, { color: colors.text }]}>{effectiveQuantity}</Text>
                <TouchableOpacity
                  style={[styles.quantityBtn, { borderColor: colors.border, opacity: effectiveQuantity >= maxQuantity ? 0.4 : 1 }]}
                  onPress={() => setQuantity(q => Math.min(maxQuantity, q + 1))}
                  disabled={effectiveQuantity >= maxQuantity}
                  accessibilityRole="button"
                  accessibilityLabel="Increase quantity"
                >
                  <IconSymbol name="plus" size={16} color={colors.text} />
                </TouchableOpacity>
                {selectedStock !== null && (
                  <Text style={[styles.quantityHint, { color: colors.secondaryText }]}>{selectedStock} available</Text>
                )}
              </View>
            </View>
          )}

          {/* Notify Me when the selected size is out of stock */}
          {selectedSizeOutOfStock && (
            <TouchableOpacity
              style={[styles.notifyBtn, { borderColor: colors.tint, opacity: notifySubmitting ? 0.6 : 1 }]}
              onPress={handleNotifyMe}
              disabled={notifySubmitting || notifyRequested}
              accessibilityRole="button"
              accessibilityLabel={notifyRequested ? "You will be notified when this size is back in stock" : "Notify me when this size is back in stock"}
            >
              <IconSymbol name={notifyRequested ? "checkmark.circle.fill" : "bell.fill"} size={18} color={colors.tint} />
              <Text style={[styles.notifyBtnText, { color: colors.tint }]}>
                {notifyRequested ? "We'll notify you when it's back" : "Notify Me When Available"}
              </Text>
            </TouchableOpacity>
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

          {/* Description sits below the factual details: those answer "will
              this fit me", which is the question that decides a reservation,
              where the description is marketing copy. */}
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

          {/* Secondary action, so it sits after the buying decision rather
              than above the size and colour pickers. */}
          <TouchableOpacity
            style={[styles.messageButton, { borderColor: colors.tint }]}
            onPress={handleMessageSeller}
            accessibilityRole="button"
            accessibilityLabel="Ask the shop owner a question about this item"
          >
            <IconSymbol name="envelope.fill" size={20} color={colors.tint} />
            <Text style={[styles.messageButtonText, { color: colors.tint }]}>Ask a Question about this item</Text>
          </TouchableOpacity>

          {/* Customer Reviews & Ratings */}
          <ReviewsList productId={product.id} />

          {/* Related Products */}
          {getMainCategoryId(product) && (
            <RelatedProducts
              mainCategoryId={getMainCategoryId(product)}
              currentProductId={product.id}
              currentSubCategoryId={product.category_id}
            />
          )}

          <RecentlyViewed excludeProductId={product.id} />

          <ImageViewerModal
            visible={!!viewerUri}
            uri={viewerUri}
            onClose={() => setViewerUri(null)}
          />

          {hasSizeChart && sizeChart && (
            <SizeChartModal
              visible={sizeChartVisible}
              measurements={sizeChart}
              sizes={product.sizes || []}
              recommendedSize={recommendedSize}
              onClose={() => setSizeChartVisible(false)}
            />
          )}

          {/* Spacer for sticky bottom bar */}
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.iconAction, { borderColor: colors.border, opacity: canPurchase ? 1 : 0.4 }]}
            onPress={() => {
              if (product && canPurchase) {
                addToCart(product, effectiveQuantity, selectedSize || undefined, selectedColor || undefined);
                setAddedToBag(true);
                setTimeout(() => setAddedToBag(false), 2000);
              }
            }}
            disabled={!canPurchase}
            accessibilityRole="button"
            accessibilityLabel="Add to shopping bag"
            accessibilityHint={
              selectedSizeOutOfStock
                ? "The selected size is out of stock"
                : "Adds the selected size and color of this item to your cart"
            }
            accessibilityState={{ disabled: !canPurchase }}
          >
            <IconSymbol name="bag.badge.plus" size={24} color={colors.text} />
          </TouchableOpacity>

          {addedToBag && (
            <View style={[styles.addedToast, { backgroundColor: colors.tint }]}>
              <IconSymbol name="checkmark" size={14} color={colors.onTint} />
              <Text style={[styles.addedToastText, { color: colors.onTint }]}>Added to Bag!</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryAction, {
              backgroundColor: canPurchase ? colors.tint : colors.border,
              opacity: canPurchase ? 1 : 0.7,
            }]}
            onPress={() => {
              if (product && canPurchase) {
                router.push({
                  pathname: "/reserve/[id]",
                  params: { id: product.id, size: selectedSize || "", color: selectedColor || "" },
                });
              }
            }}
            disabled={!canPurchase}
            accessibilityRole="button"
            accessibilityLabel={selectedSizeOutOfStock ? "Out of Stock" : "Reserve Now"}
            accessibilityHint={
              selectedSizeOutOfStock
                ? "The selected size is out of stock"
                : canPurchase
                  ? "Starts the reservation process for this item"
                  : "Choose a size and color to enable reservation"
            }
            accessibilityState={{ disabled: !canPurchase }}
          >
            <Text style={styles.primaryActionText}>
              {selectedSizeOutOfStock ? "Out of Stock" : "Reserve Now"}
            </Text>
          </TouchableOpacity>
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
    gap: Spacing.sm,
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
  // `top` is supplied inline from useSafeAreaInsets: these float over the image
  // with edge-to-edge enabled, so a hardcoded guess put them under the status
  // bar on any device with a taller one.
  backButton: {
    position: "absolute", left: 20,
    width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center",
  },
  favoriteButton: {
    position: "absolute", right: 20,
    width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center",
  },
  shareButton: {
    position: "absolute", right: 76,
    width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center",
  },
  arButton: {
    position: "absolute", bottom: 60, right: 20, flexDirection: "row", alignItems: "center",
    paddingHorizontal: Spacing.lg, paddingVertical: 10, borderRadius: 20, gap: Spacing.sm,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  arButtonText: { fontWeight: "700", fontSize: 14 },
  contentContainer: { padding: Spacing.xxl, borderTopLeftRadius: 30, borderTopRightRadius: 30, marginTop: -30 },
  // One clear step down at each level: 26/800 name, 20/700 price, 16/700
  // section headings, 12/700 eyebrow. Previously the name was 26/800 and the
  // price 24/800, which read as two headings.
  // 26 has no slot; headline is 24/800, same weight two points down.
  title: { ...Type.headline, marginBottom: 6 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  ratingValue: { fontSize: 13, fontWeight: "700" },
  ratingCount: { fontSize: 13 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.xl },
  price: { ...Type.title },
  priceOriginal: { fontSize: 14, textDecorationLine: 'line-through', fontWeight: '500' },
  priceSale: { fontSize: 20, fontWeight: "800" },
  discountBadge: { backgroundColor: '#E05C5C', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  discountText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  // Uppercase eyebrow: exactly what Type.label's tracking exists for.
  category: { ...Type.label, marginBottom: 6 },
  section: { marginTop: Spacing.xxl },
  sizeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.lg },
  recBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.md, gap: Spacing.xs },
  recText: { fontSize: 12, fontWeight: "700" },
  sizeHeaderActions: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  sizeChartLink: { fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
  sectionTitle: { ...Type.bodyLargeStrong, marginBottom: Spacing.md },
  description: { fontSize: 15, lineHeight: 24 },
  optionsList: { gap: Spacing.md, paddingRight: Spacing.xl },
  optionButton: { paddingHorizontal: Spacing.xl, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  optionText: { fontSize: 15, fontWeight: "600" },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: Spacing.lg },
  quantityBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    justifyContent: "center", alignItems: "center",
  },
  quantityValue: { fontSize: 18, fontWeight: "700", minWidth: 24, textAlign: "center" },
  quantityHint: { fontSize: 13, marginLeft: Spacing.xs },
  notifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    marginTop: Spacing.xxl,
    gap: Spacing.sm,
  },
  notifyBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailsSection: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.xxxl,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
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
    paddingVertical: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    marginTop: Spacing.xxl,
    gap: Spacing.sm,
  },
  messageButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: Spacing.xxl, paddingVertical: Platform.OS === "ios" ? 32 : 20,
    borderTopWidth: 1, flexDirection: "row", alignItems: "center",
  },
  actionButtons: { flexDirection: "row", flex: 1, gap: Spacing.lg },
  iconAction: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  primaryAction: {
    flex: 1, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center",
    shadowColor: "#C9A96E", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  primaryActionText: { ...Type.subtitle },
  addedToast: {
    position: 'absolute', top: -40, left: 0, right: 0, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: 20,
  },
  addedToastText: { fontWeight: '700', fontSize: 14 },
});
