import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, AccessibilityInfo, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCart } from '@/src/context/CartContext';
import { tapLight, notifySuccess } from '@/src/utils/haptics';
import { CompleteTheLookItem as CompleteTheLookItemType } from '@/src/services/completeTheLookService';

interface Props {
  item: CompleteTheLookItemType;
}

/**
 * One row in the Complete the Look sheet: the product, its own size/color
 * selector, and an Add to Bag action. Variant options are built only from
 * item.sellableVariants (already filtered to available > 0, not deleted) --
 * never the full inventory list, matching product/[id].tsx's own
 * canPurchase gating so this can't offer a variant the server would reject.
 */
export function CompleteTheLookItem({ item }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { addToCart } = useCart();

  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);

  const sizes = useMemo(
    () => [...new Set(item.sellableVariants.map((v) => v.size).filter((s): s is string => !!s))],
    [item.sellableVariants],
  );

  // Colors narrow to whatever's left once a size is picked, same as the
  // product page's own color-chip behavior.
  const colorsForSelectedSize = useMemo(() => {
    const pool = selectedSize ? item.sellableVariants.filter((v) => v.size === selectedSize) : item.sellableVariants;
    return [...new Set(pool.map((v) => v.color).filter((c): c is string => !!c))];
  }, [item.sellableVariants, selectedSize]);

  // Auto-pick the only option so a single-variant product never needs a tap.
  useEffect(() => {
    if (!selectedSize && sizes.length === 1) setSelectedSize(sizes[0]);
  }, [sizes, selectedSize]);
  useEffect(() => {
    if (!selectedColor && colorsForSelectedSize.length === 1) setSelectedColor(colorsForSelectedSize[0]);
  }, [colorsForSelectedSize, selectedColor]);

  const matchingVariant = item.sellableVariants.find(
    (v) => (!selectedSize || v.size === selectedSize) && (!selectedColor || v.color === selectedColor),
  );
  const needsSize = sizes.length > 0;
  const needsColor = colorsForSelectedSize.length > 0;
  const hasRequiredSelection = (!needsSize || !!selectedSize) && (!needsColor || !!selectedColor);
  const canAdd = hasRequiredSelection && !!matchingVariant;

  const handleAdd = () => {
    if (!canAdd || !matchingVariant) return;
    // Stock is re-validated atomically by the cart/checkout flow on submit;
    // this is a UI-level gate, not the trust boundary.
    addToCart(item.product, 1, selectedSize || undefined, selectedColor || undefined, matchingVariant.available ?? undefined);
    notifySuccess();
    setJustAdded(true);
    AccessibilityInfo.announceForAccessibility(`${item.product.name} added to bag`);
    setTimeout(() => setJustAdded(false), 2000);
  };

  const price = item.product.sale_price ?? item.product.price ?? 0;

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Image
        source={item.product.image_url ? { uri: item.product.image_url } : undefined}
        style={[styles.image, { backgroundColor: colors.imagePlaceholder }]}
        resizeMode="cover"
      />
      <View style={styles.details}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.product.name}
        </Text>
        <Text style={[styles.price, { color: colors.tint }]}>₱{price.toFixed(2)}</Text>

        {sizes.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
            {sizes.map((size) => {
              const active = selectedSize === size;
              return (
                <TouchableOpacity
                  key={size}
                  onPress={() => { tapLight(); setSelectedSize(size); setSelectedColor(null); }}
                  style={[styles.optionChip, { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Size ${size}`}
                >
                  <Text style={[styles.optionText, { color: active ? colors.onTint : colors.text }]}>{size}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {colorsForSelectedSize.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
            {colorsForSelectedSize.map((color) => {
              const active = selectedColor === color;
              return (
                <TouchableOpacity
                  key={color}
                  onPress={() => { tapLight(); setSelectedColor(color); }}
                  style={[styles.optionChip, { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Color ${color}`}
                >
                  <Text style={[styles.optionText, { color: active ? colors.onTint : colors.text }]}>{color}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <TouchableOpacity
          onPress={handleAdd}
          disabled={!canAdd}
          style={[styles.addButton, { backgroundColor: canAdd ? colors.tint : colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={justAdded ? `${item.product.name} added to bag` : `Add ${item.product.name} to bag`}
          accessibilityState={{ disabled: !canAdd }}
        >
          <Text style={[styles.addButtonText, { color: colors.onTint }]}>
            {justAdded ? 'Added ✓' : hasRequiredSelection ? 'Add to Bag' : 'Select options'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  image: {
    width: 88,
    height: 108,
    borderRadius: Radius.sm,
  },
  details: {
    flex: 1,
    gap: Spacing.xs,
  },
  name: {
    ...Type.bodyLargeStrong,
  },
  price: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: Spacing.xs,
  },
  optionRow: {
    gap: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  optionChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    minWidth: 32,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addButton: {
    marginTop: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
