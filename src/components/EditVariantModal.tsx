import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { normalizeSizes } from '@/src/utils/sizeOrder';

type Product = Database['public']['Tables']['products']['Row'];
type ProductVariant = Database['public']['Views']['product_variants']['Row'];

interface EditVariantModalProps {
  visible: boolean;
  product: Product;
  currentSize?: string;
  currentColor?: string;
  onClose: () => void;
  onSave: (variantId: string, size?: string, color?: string, maxQuantity?: number) => void;
}

export function EditVariantModal({ visible, product, currentSize, currentColor, onClose, onSave }: EditVariantModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [size, setSize] = useState(currentSize);
  const [color, setColor] = useState(currentColor);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    supabase
      .from('product_variants')
      .select('*')
      .eq('product_doc_id', product.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setVariants(data);
      });
    return () => { cancelled = true; };
  }, [visible, product.id]);

  const sizes = normalizeSizes(product.sizes || []);
  const colorOptions = product.color
    ? [...new Set(product.color.split(',').map(c => c.trim()).filter(Boolean))]
    : [];

  const getVariant = (s?: string, c?: string): ProductVariant | undefined => {
    if (!s) return undefined;
    return variants.find((v) =>
      v.size === s &&
      (!c || !v.color || v.color.toLowerCase() === c.toLowerCase())
    );
  };

  // Real per-variant remaining count, sourced from product_variants.available
  // (same source as the product detail screen). Falls back to the boolean
  // is_available (as 0/1) if a row predates the migration.
  const getStockCount = (s?: string, c?: string): number | null => {
    const v = getVariant(s, c);
    if (!v) return null;
    const count = (v as any).available;
    return typeof count === 'number' ? count : (v.is_available ? 1 : 0);
  };

  const handleSave = () => {
    const v = getVariant(size, color);
    const variantId = v?.id || `${product.id}:${size ?? ''}:${color ?? ''}`;
    const stock = getStockCount(size, color);
    onSave(variantId, size, color, stock !== null ? stock : undefined);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Change Size / Color</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {colorOptions.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Color</Text>
                <View style={styles.optionsList}>
                  {colorOptions.map((c) => {
                    const isSelected = color === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[
                          styles.optionButton,
                          { borderColor: isSelected ? colors.tint : colors.border },
                          isSelected && { backgroundColor: colors.card },
                        ]}
                        onPress={() => setColor(c)}
                        accessibilityRole="button"
                        accessibilityLabel={`Select color ${c}`}
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text style={[styles.optionText, { color: isSelected ? colors.tint : colors.text }]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {sizes.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Size</Text>
                <View style={styles.optionsList}>
                  {sizes.map((s) => {
                    const isSelected = size === s;
                    const matchingVariant = getVariant(s, color);
                    const isSoldOut = matchingVariant !== undefined && !matchingVariant.is_available;
                    const stock = getStockCount(s, color);
                    return (
                      <View key={s} style={styles.optionWrap}>
                        <TouchableOpacity
                          style={[
                            styles.optionButton,
                            { borderColor: isSelected ? colors.tint : colors.border },
                            isSelected && { backgroundColor: colors.card },
                            isSoldOut && styles.optionDisabled,
                          ]}
                          onPress={() => !isSoldOut && setSize(s)}
                          disabled={isSoldOut}
                          accessibilityRole="button"
                          accessibilityLabel={`Select size ${s}`}
                          accessibilityHint={isSoldOut ? `Size ${s} is out of stock` : undefined}
                          accessibilityState={{ selected: isSelected, disabled: isSoldOut }}
                        >
                          <Text style={[styles.optionText, { color: isSelected ? colors.tint : colors.text }]}>{s}</Text>
                        </TouchableOpacity>
                        {isSoldOut ? (
                          <Text style={[styles.stockHint, { color: colors.secondaryText }]}>Out of stock</Text>
                        ) : stock !== null && stock > 0 && stock <= 5 ? (
                          <Text style={[styles.stockHint, { color: colors.warning }]}>Only {stock} left</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.tint }]}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Save changes"
            >
              <Text style={[styles.saveBtnText, { color: colors.onTint }]}>Save</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerTitle: {
    ...Type.subtitle,
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: Spacing.sm,
  },
  body: {
    padding: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.xxl,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  optionsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  optionWrap: { alignItems: 'center' },
  optionButton: { paddingHorizontal: Spacing.xl, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  optionDisabled: { opacity: 0.4 },
  optionText: { ...Type.bodyStrong },
  stockHint: { ...Type.caption, marginTop: Spacing.xs, fontSize: 11 },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
});
