import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useWishlist } from '@/src/context/WishlistContext';
import { gridCardWidth } from '@/src/utils/layout';
import { getCategoryLabel } from '@/src/utils/categoryDisplay';
import { isNewArrival } from '@/src/utils/newArrival';


// 'grid' fills half the row in a two-column list; 'rail' is a fixed width for
// horizontal strips. Both share one set of internals -- the point of this
// component is that there is only one place to change a product card.
export type ProductCardVariant = 'grid' | 'rail';

const RAIL_WIDTH = 150;
const LOW_STOCK_THRESHOLD = 5;

// A percentage width does not resolve for this card in either grid it lives in
// -- the FlatList column wrapper on Explore or the wrapping row on Home -- so
// the card fell back to its content width, filling the row and pushing its
// neighbour off screen. Both containers leave the same usable width, which
// gridCardWidth derives from the shared grid tokens rather than restating the
// screens' padding as literals here.
const GRID_CARD_WIDTH = gridCardWidth();

type Props = {
  product: any;
  variant?: ProductCardVariant;
  /** Shown as a "Your size" chip when the fit recommender has a match. */
  recommendedSize?: string | null;
  showStock?: boolean;
};

export function ProductCard({
  product,
  variant = 'grid',
  recommendedSize,
  showStock = true,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { isInWishlist, toggleWishlist } = useWishlist();

  const onSale = !!(product.on_sale && product.sale_price);
  const price = onSale ? product.sale_price : product.price || 0;
  const saved = isInWishlist(product.id);
  const isNew = isNewArrival(product);

  // Null stock means the product predates stock tracking; treat it as unknown
  // rather than sold out.
  const stock: number | null | undefined = product.stock;
  const hasStock = stock !== null && stock !== undefined;
  const outOfStock = hasStock && stock <= 0;
  const lowStock = hasStock && stock > 0 && stock <= LOW_STOCK_THRESHOLD;

  const stockLabel = !hasStock
    ? null
    : outOfStock
      ? 'Out of stock'
      : lowStock
        ? `Only ${stock} left`
        : `${stock} in stock`;

  const stockColor = outOfStock ? colors.error : lowStock ? colors.warning : colors.secondaryText;

  const accessibilityLabel = [
    product.name,
    `₱${Number(price).toLocaleString()}`,
    onSale ? 'on sale' : null,
    isNew ? 'new arrival' : null,
    product.model_3d_url ? 'available in AR' : null,
    recommendedSize ? `your size ${recommendedSize}` : null,
    stockLabel,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    // Layout lives on this wrapper, not on the Touchable: <Link asChild>
    // clones its child and passes its own style prop down, which silently
    // discarded the card's width and margins entirely.
    <View style={[styles.card, variant === 'rail' ? styles.cardRail : styles.cardGrid]}>
    <Link href={`/product/${product.id}`} asChild>
      <TouchableOpacity
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens product details"
      >
        <View style={[styles.imageWrap, { backgroundColor: colors.imagePlaceholder }]}>
          {/* An imageless product shows the tinted placeholder colour rather
              than the Expo template's React logo, which looked like a bug. */}
          {product.image_url ? (
            <Image
              source={{ uri: product.image_url }}
              style={[styles.image, outOfStock && styles.imageDimmed]}
              contentFit="cover"
            />
          ) : null}

          {/* Left column of badges so they never collide with the heart. */}
          <View style={styles.badgeColumn}>
            {isNew && (
              <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                <Text style={[styles.badgeText, { color: colors.onTint }]}>NEW</Text>
              </View>
            )}
            {onSale && (
              <View style={[styles.badge, { backgroundColor: colors.notification }]}>
                <Text style={[styles.badgeText, { color: colors.onNotification }]}>
                  {product.discount_percentage ? `-${product.discount_percentage}%` : 'SALE'}
                </Text>
              </View>
            )}
            {(product.model_3d_url || (product.tags && product.tags.includes('AR Try-On'))) && (
              <View style={[styles.badge, styles.badgeRow, { backgroundColor: '#6366f1' }]}>
                <IconSymbol name="cube.transparent" size={10} color="#ffffff" />
                <Text style={[styles.badgeText, { color: '#ffffff' }]}>AR</Text>
              </View>
            )}
          </View>

          {/* Saving from the catalog was previously impossible without opening
              the product. Pressable rather than nesting inside the Link's
              Touchable, so the tap does not also navigate. */}
          <Pressable
            style={styles.heart}
            onPress={() => toggleWishlist(product.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
            accessibilityState={{ selected: saved }}
          >
            <BlurView intensity={40} tint="light" style={styles.heartBg}>
              <IconSymbol
                name={saved ? 'heart.fill' : 'heart'}
                size={16}
                // Sits on a dark scrim over the product image, so the logo
                // pink is the right variant regardless of app theme.
                color={saved ? Colors.dark.blushFill : '#FFF'}
              />
            </BlurView>
          </Pressable>

          {outOfStock && (
            <View style={styles.soldOutOverlay}>
              <Text style={styles.soldOutText}>SOLD OUT</Text>
            </View>
          )}
        </View>

        <View style={styles.info}>
          <Text style={[styles.category, { color: colors.secondaryText }]} numberOfLines={1}>
            {getCategoryLabel(product, 'COLLECTION').toUpperCase()}
          </Text>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {product.name}
          </Text>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: onSale ? colors.notification : colors.text }]}>
              ₱{Number(price).toLocaleString()}
            </Text>
            {onSale && (
              <Text style={[styles.priceWas, { color: colors.secondaryText }]}>
                ₱{Number(product.price || 0).toLocaleString()}
              </Text>
            )}
          </View>

          {recommendedSize ? (
            <View style={styles.fitRow}>
              <IconSymbol name="checkmark.circle.fill" size={11} color={colors.tint} />
              <Text style={[styles.fitText, { color: colors.tint }]} numberOfLines={1}>
                Your size: {recommendedSize}
              </Text>
            </View>
          ) : null}

          {showStock && stockLabel ? (
            <Text style={[styles.stock, { color: stockColor }]}>{stockLabel}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 20 },
  cardGrid: { width: GRID_CARD_WIDTH },
  cardRail: { width: RAIL_WIDTH, marginRight: 14, marginBottom: 0 },
  imageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  imageDimmed: { opacity: 0.45 },
  badgeColumn: { position: 'absolute', top: 8, left: 8, gap: 4, alignItems: 'flex-start' },
  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  heart: { position: 'absolute', top: 6, right: 6 },
  // Real backdrop blur (expo-blur BlurView), not a flat rgba(0,0,0,0.45)
  // fill: floats over a product photo in every card variant, the one case
  // in this shared component where translucency reveals real content
  // (Apple HIG Materials guidance). overflow hidden clips the blur to the
  // circle rather than bleeding a square past the rounded corners. The
  // NEW/SALE badges stay opaque on purpose -- they're status/urgency
  // indicators, not chrome, and need maximum legibility, not softening.
  heartBg: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  soldOutOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '45%',
    alignItems: 'center',
  },
  soldOutText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#FFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  info: { paddingTop: 8, paddingHorizontal: 2, gap: 3 },
  category: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  name: { fontSize: 13, fontWeight: '500' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: 13, fontWeight: '700' },
  priceWas: { fontSize: 12, textDecorationLine: 'line-through' },
  fitRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fitText: { fontSize: 12, fontWeight: '700' },
  stock: { fontSize: 12, fontWeight: '600' },
});
