import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ProductMeasurements } from '@/src/utils/sizeRecommender';

const CM_TO_IN = 1 / 2.54;

interface SizeChartModalProps {
  visible: boolean;
  measurements: ProductMeasurements;
  sizes: string[];
  recommendedSize?: string | null;
  onClose: () => void;
}

const COLUMNS: { key: 'bust' | 'waist' | 'hips' | 'inseam' | 'length'; label: string }[] = [
  { key: 'bust', label: 'Bust' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'inseam', label: 'Inseam' },
  { key: 'length', label: 'Length' },
];

export function SizeChartModal({ visible, measurements, sizes, recommendedSize, onClose }: SizeChartModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');

  // Only show sizes the product actually lists, and only columns with data.
  const rows = sizes.filter(s => measurements[s]);
  const activeColumns = COLUMNS.filter(c => rows.some(s => measurements[s]?.[c.key] != null));

  // Source data is always centimetres; inches are display-only, rounded to
  // one decimal since garment measurements don't need finer precision.
  const formatValue = (cm: number | null | undefined): string => {
    if (cm == null) return '-';
    return unit === 'cm' ? String(cm) : (cm * CM_TO_IN).toFixed(1);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Size Chart</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close size chart">
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {rows.length > 0 && activeColumns.length > 0 && (
            <View style={styles.unitToggleRow}>
              <View style={[styles.unitToggle, { borderColor: colors.border }]}>
                {(['cm', 'in'] as const).map(u => (
                  <TouchableOpacity
                    key={u}
                    onPress={() => setUnit(u)}
                    style={[styles.unitOption, unit === u && { backgroundColor: colors.tint }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Show measurements in ${u === 'cm' ? 'centimetres' : 'inches'}`}
                  >
                    <Text style={[styles.unitOptionText, { color: unit === u ? '#0D0D0D' : colors.secondaryText }]}>
                      {u.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {rows.length === 0 || activeColumns.length === 0 ? (
            <Text style={[styles.empty, { color: colors.secondaryText }]}>
              No measurement details are available for this item.
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={[styles.caption, { color: colors.secondaryText }]}>
                Garment measurements in {unit === 'cm' ? 'centimetres' : 'inches'}.
              </Text>

              <View style={[styles.row, styles.headRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.cell, styles.sizeCell, styles.headText, { color: colors.text }]}>Size</Text>
                {activeColumns.map(c => (
                  <Text key={c.key} style={[styles.cell, styles.headText, { color: colors.text }]}>{c.label}</Text>
                ))}
              </View>

              {rows.map(size => {
                const isRecommended = size === recommendedSize;
                return (
                  <View
                    key={size}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.border },
                      isRecommended && { backgroundColor: colors.tint + '20' },
                    ]}
                  >
                    <Text style={[styles.cell, styles.sizeCell, { color: isRecommended ? colors.tint : colors.text, fontWeight: '700' }]}>
                      {size}
                    </Text>
                    {activeColumns.map(c => (
                      <Text key={c.key} style={[styles.cell, { color: colors.secondaryText }]}>
                        {formatValue(measurements[size]?.[c.key])}
                      </Text>
                    ))}
                  </View>
                );
              })}

              {recommendedSize && (
                <Text style={[styles.caption, { color: colors.tint, marginTop: 16 }]}>
                  Highlighted row is your recommended size.
                </Text>
              )}
            </ScrollView>
          )}
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
    maxHeight: Dimensions.get('window').height * 0.7,
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
    padding: 24,
  },
  unitToggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 16,
  },
  unitToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  unitOption: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  unitOptionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  caption: {
    fontSize: 13,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
  },
  headRow: {
    borderBottomWidth: 1,
  },
  cell: {
    flex: 1,
    fontSize: 14,
    textAlign: 'center',
  },
  sizeCell: {
    flex: 0.7,
    textAlign: 'left',
    paddingLeft: 8,
  },
  headText: {
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    fontSize: 15,
    textAlign: 'center',
    padding: 32,
  },
});
