import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ProductMeasurements } from '@/src/utils/sizeRecommender';

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

  // Only show sizes the product actually lists, and only columns with data.
  const rows = sizes.filter(s => measurements[s]);
  const activeColumns = COLUMNS.filter(c => rows.some(s => measurements[s]?.[c.key] != null));

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

          {rows.length === 0 || activeColumns.length === 0 ? (
            <Text style={[styles.empty, { color: colors.secondaryText }]}>
              No measurement details are available for this item.
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={[styles.caption, { color: colors.secondaryText }]}>
                Garment measurements in centimetres.
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
                        {measurements[size]?.[c.key] ?? '-'}
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
