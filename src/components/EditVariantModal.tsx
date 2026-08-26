import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';

type Product = Database['public']['Tables']['products']['Row'];

interface EditVariantModalProps {
  visible: boolean;
  product: Product;
  currentSize?: string;
  currentColor?: string;
  onClose: () => void;
  /** maxQuantity is inventory.available for the size being switched to. */
  onSave: (size?: string, color?: string, maxQuantity?: number) => void;
}

export function EditVariantModal({ visible, product, currentSize, currentColor, onClose, onSave }: EditVariantModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [size, setSize] = useState(currentSize);
  const [color, setColor] = useState(currentColor);
  // Composite variant availability (key: "size|color" or fallback "size")
  const [stockByVariant, setStockByVariant] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    supabase
      .from('inventory')
      .select('size, color, available')
      .eq('product_doc_id', product.id)
      .eq('deleted', false)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, number> = {};
        data.forEach((row: any) => {
          const key = `${row.size ?? ''}|${row.color ?? ''}`;
          map[key] = row.available ?? 0;
          if (row.size && !(row.size in map)) {
            map[row.size] = row.available ?? 0;
          }
        });
        setStockByVariant(map);
      });
    return () => { cancelled = true; };
  }, [visible, product.id]);

  const sizes = product.sizes || [];
  const colorOptions = product.color ? product.color.split(',').map(c => c.trim()) : [];

  const getStock = (s?: string, c?: string) => {
    if (!s) return undefined;
    const key = `${s}|${c ?? ''}`;
    if (key in stockByVariant) return stockByVariant[key];
    if (s in stockByVariant) return stockByVariant[s];
    return undefined;
  };

  const handleSave = () => {
    // Undefined when the variant has no inventory row -- untracked, so
    // uncapped, matching the server-side hold trigger's own fallback.
    const stock = getStock(size, color);
    onSave(size, color, stock);
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
                    // Only treat as sold out when we positively know it is --
                    // an absent row means untracked, not unavailable.
                    const available = getStock(s, color);
                    const isSoldOut = available !== undefined && available <= 0;
                    return (
                      <TouchableOpacity
                        key={s}
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
    paddingVertical: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
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
  optionButton: { paddingHorizontal: Spacing.xl, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  optionDisabled: { opacity: 0.4 },
  optionText: { fontSize: 15, fontWeight: '600' },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
});
