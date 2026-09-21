import type { Database } from '@/src/types/database.types';
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Colors, Type, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useWishlist } from '@/src/context/WishlistContext';
import { useGridCardWidth } from '@/src/utils/layout';
import { getCategoryLabel } from '@/src/utils/categoryDisplay';
import { isNewArrival } from '@/src/utils/newArrival';


// 'grid' fills half the row in a dynamic-column list; 'rail' is a fixed width for
// horizontal strips. Both share one set of internals -- the point of this
// component is that there is only one place to change a product card.
export type ProductCardVariant = 'grid' | 'rail';

const RAIL_WIDTH = 164;
const LOW_STOCK_THRESHOLD = 5;

type Props = {
  product: Database['public']['Tables']['products']['Row'] & { categories?: any, category?: any };
  variant?: ProductCardVariant;
  /** Shown as a "Your size" chip when the fit recommender has a match. */
  recommendedSize?: string | null;
  showStock?: boolean;
  aspectRatio?: number;
};

export function ProductCard({
  product,
  variant = 'grid',
  recommendedSize,
  showStock = true,
  aspectRatio,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { cardWidth } = useGridCardWidth();

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

  const restockDateStr = outOfStock && (product as any).restock_date
    ? `Restock Expected: ${new Date((product as any).restock_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null;

  const stockColor = outOfStock ? colors.error : lowStock ? colors.warning : colors.secondaryText;

  const accessibilityLabel = [
    product.name,
    `₱${Number(price).toLocaleString()}`,
    onSale ? 'on sale' : null,
    isNew ? 'new arrival' : null,
    (product.model_3d_url && product.tags && product.tags.includes('AR Try-On')) ? 'available in AR' : null,
    recommendedSize ? `your size ${recommendedSize}` : null,
    stockLabel,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    // Layout lives on this wrapper, not on the Touchable: <Link asChild>
    // clones its child and passes its own style prop down, which silently
    // discarded the card's width and margins entirely.
    <View style={[styles.card, variant === 'rail' ? styles.cardRail : [styles.cardGrid, { width: cardWidth }]]}>
    <Link href={`/product/${product.id}`} asChild>
      <TouchableOpacity
        activeOpacity={0.85}
        accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens product details"
      >
        <View style={[
          styles.imageWrap,
          { 
            backgroundColor: theme === 'dark' ? colors.surface : '#F7F7F7',
            borderColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            borderWidth: 1
          }, 
          aspectRatio ? { aspectRatio } : undefined
        ]}>
          {/* An imageless product shows the tinted placeholder colour rather
              than the Expo template's React logo, which looked like a bug. */}
          {product.image_url ? (
            <Image
              source={{ uri: product.image_url }}
              style={[styles.image, outOfStock && styles.imageDimmed]}
              contentFit="cover"
              transition={300}
              cachePolicy="memory-disk"
            />
          ) : null}

          {/* One status badge keeps the product image calm; AR has its own
              fixed corner so it never competes with sale or newness. */}
          <View style={styles.badgeColumn}>
            {outOfStock && (
              <View style={[styles.badge, styles.badgeSoldOut]}>
                <Text style={[styles.badgeText, styles.badgeSoldOutText]}>SOLD OUT</Text>
              </View>
            )}
            {onSale && !outOfStock ? (
              <View style={[styles.badge, { backgroundColor: colors.notification }]}>
                <Text style={[styles.badgeText, { color: colors.onNotification }]}>
                  {product.discount_percentage ? `-${product.discount_percentage}%` : 'SALE'}
                </Text>
              </View>
            ) : isNew && !outOfStock ? (
              <View style={[styles.badge, styles.badgeRow, { backgroundColor: colors.tint }]}>
                <IconSymbol name="sparkles" size={10} color={colors.onTint} />
                <Text style={[styles.badgeText, { color: colors.onTint }]}>NEW</Text>
              </View>
            ) : null}
          </View>

          {!!(product.model_3d_url && product.tags && product.tags.includes('AR Try-On')) && (
            <View style={styles.arBadge}>
              <IconSymbol name="cube.transparent" size={10} color="#ffffff" />
              <Text style={styles.arBadgeText}>AR</Text>
            </View>
          )}

          {/* Saving from the catalog was previously impossible without opening
              the product. Pressable rather than nesting inside the Link's
              Touchable, so the tap does not also navigate. */}
          <Pressable
            style={styles.heart}
            onPress={() => toggleWishlist(product.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={outOfStock
              ? `Save ${product.name} — notify me when available`
              : saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
            accessibilityState={{ selected: saved }}
          >
            {/* tint="dark" (not "light"): the blur must darken whatever
                photo sits behind it, not brighten it -- a light tint over a
                white/pale product photo left a white heart icon with almost
                no contrast. Dark tint makes white reliably legible
                regardless of the photo underneath. */}
            <BlurView intensity={40} tint="dark" style={styles.heartBg}>
              <IconSymbol
                name={saved ? 'heart.fill' : 'heart'}
                size={16}
                // Sits on a dark blur regardless of app theme, so the logo
                // pink is the right variant regardless of app theme.
                color={saved ? Colors.dark.blushFill : '#FFF'}
              />
            </BlurView>
          </Pressable>
        </View>

        <View style={[styles.info, outOfStock && styles.infoMuted]}>
          <Text style={[styles.category, { color: colors.secondaryText }]} numberOfLines={1}>
            {getCategoryLabel(product, 'COLLECTION').toUpperCase()}
          </Text>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {product.name}
          </Text>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: onSale ? colors.notification : colors.text }, outOfStock && styles.priceMuted]}>
              ₱{Number(price).toLocaleString()}
            </Text>
            {onSale && (
              <Text style={[styles.priceWas, { color: colors.secondaryText }]}>
                ₱{Number(product.price || 0).toLocaleString()}
              </Text>
            )}
          </View>

          {recommendedSize && !outOfStock ? (
            <View style={styles.fitRow}>
              <IconSymbol name="checkmark.circle.fill" size={11} color={colors.tint} />
              <Text style={[styles.fitText, { color: colors.tint }]} numberOfLines={1}>
                Your size: {recommendedSize}
              </Text>
            </View>
          ) : null}

          {showStock && outOfStock ? (
            <Text style={styles.notifyText}>
              {restockDateStr || 'Notify me when available'}
            </Text>
          ) : showStock && stockLabel ? (
            <Text style={[styles.stock, { color: stockColor }]}>{stockLabel}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.xl },
  cardGrid: {},
  cardRail: { width: RAIL_WIDTH, marginBottom: 0 },
  imageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  // 25% dim — preserves the product photography while signalling unavailability.
  imageDimmed: { opacity: 0.75 },
  badgeColumn: { position: 'absolute', top: 8, left: 8, gap: Spacing.xs, alignItems: 'flex-start' },
  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.sm },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badgeText: { ...Type.caption, fontWeight: '800' },
  // Neutral grey badge — same badge system as NEW/SALE, just a disabled treatment.
  badgeSoldOut: { backgroundColor: 'rgba(0,0,0,0.45)' },
  badgeSoldOutText: { color: '#FFF', letterSpacing: 1 },
  arBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: '#6366F1',
  },
  arBadgeText: { ...Type.caption, color: '#FFF', fontWeight: '800' },
  heart: { position: 'absolute', top: 8, right: 8 },
  // Real backdrop blur (expo-blur BlurView), not a flat rgba(0,0,0,0.45)
  // fill: floats over a product photo in every card variant, the one case
  // in this shared component where translucency reveals real content
  // (Apple HIG Materials guidance). overflow hidden clips the blur to the
  // circle rather than bleeding a square past the rounded corners. The
  // NEW/SALE badges stay opaque on purpose -- they're status/urgency
  // indicators, not chrome, and need maximum legibility, not softening.
  heartBg: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: { paddingTop: Spacing.sm, paddingHorizontal: Spacing.xs, gap: 3 },
  // Sold-out info block is slightly muted so it reads as non-actionable.
  infoMuted: { opacity: 0.7 },
  category: { ...Type.label },
  name: { ...Type.body },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { ...Type.bodyStrong },
  priceMuted: { opacity: 0.55 },
  priceWas: { ...Type.caption, textDecorationLine: 'line-through' },
  fitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  fitText: { ...Type.caption, fontWeight: '700' },
  stock: { ...Type.caption, fontWeight: '600' },
  notifyText: { ...Type.caption, fontWeight: '600', fontStyle: 'italic', color: '#888' },
});


