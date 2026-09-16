import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ProductMeasurements } from '@/src/utils/sizeRecommender';
import { normalizeSizes } from '@/src/utils/sizeOrder';

const CM_TO_IN = 1 / 2.54;

interface SizeChartModalProps {
  visible: boolean;
  measurements: ProductMeasurements;
  sizes: string[];
  recommendedSize?: string | null;
  onClose: () => void;
}

// Preferred display labels for known metric keys, matched case/spacing
// -insensitively so admin-entered variants (e.g. "Total Length" vs "length",
// "Hip" vs "hips") still resolve to one consistent label. Any key not listed
// here falls back to a title-cased version of the key itself, so a metric
// from any product category (shoes, bags, accessories...) still renders
// instead of being silently dropped for not matching a fixed garment list.
const KNOWN_LABELS: Record<string, string> = {
  bust: 'Bust', chest: 'Chest', waist: 'Waist', hips: 'Hips', hip: 'Hips',
  shoulder: 'Shoulder', shoulderwidth: 'Shoulder Width', sleevelength: 'Sleeve Length',
  bodylength: 'Body Length', thigh: 'Thigh', inseam: 'Pants', outseam: 'Outseam',
  totallength: 'Total Length', length: 'Length', cuff: 'Cuff', footlength: 'Foot Length',
  footwidth: 'Foot Width', width: 'Width', height: 'Height', depth: 'Depth',
  straplength: 'Strap Length',
};

const titleCase = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> spaced
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const labelFor = (key: string) => {
  const norm = key.toLowerCase().replace(/[\s_-]+/g, '');
  return KNOWN_LABELS[norm] || titleCase(key);
};

export function SizeChartModal({ visible, measurements, sizes, recommendedSize, onClose }: SizeChartModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');

  // Measurements are keyed by whatever metric names the admin entered for
  // this product's category -- not just the garment-specific bust/waist/hips
  // set -- so this reads them generically rather than through the narrower
  // ProductMeasurements type made for the fit recommender.
  const raw = measurements as unknown as Record<string, Record<string, number | string | null | undefined> | undefined>;

  // Only show sizes the product actually lists, in canonical apparel order.
  const normalized = normalizeSizes(sizes);
  const rows = normalized.filter(s => raw[s]);

  // Columns are whatever metric keys actually have data, in the order they
  // first appear, so any category's measurement set renders as authored.
  const activeColumns = (() => {
    const seen = new Set<string>();
    const columns: { key: string; label: string }[] = [];
    rows.forEach((s) => {
      const row = raw[s];
      if (!row) return;
      Object.keys(row).forEach((key) => {
        if (row[key] == null || seen.has(key)) return;
        seen.add(key);
        columns.push({ key, label: labelFor(key) });
      });
    });
    return columns;
  })();

  // Source data is always centimetres; inches are display-only, rounded to
  // one decimal since these measurements don't need finer precision.
  const formatValue = (cm: number | string | null | undefined): string => {
    if (cm == null || cm === '') return '-';
    const num = typeof cm === 'number' ? cm : parseFloat(cm);
    if (Number.isNaN(num)) return String(cm);
    return unit === 'cm' ? String(num) : (num * CM_TO_IN).toFixed(1);
  };

  if (!visible) return null;

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
                    <Text style={[styles.unitOptionText, { color: unit === u ? colors.onTint : colors.secondaryText }]}>
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
                Measurements in {unit === 'cm' ? 'centimetres' : 'inches'}.
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
                        {formatValue(raw[size]?.[c.key])}
                      </Text>
                    ))}
                  </View>
                );
              })}

              {recommendedSize && (
                <Text style={[styles.caption, { color: colors.tint, marginTop: Spacing.lg }]}>
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
    padding: Spacing.xxl,
  },
  unitToggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: Spacing.lg,
  },
  unitToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  unitOption: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  unitOptionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  caption: {
    fontSize: 13,
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
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
    paddingLeft: Spacing.sm,
  },
  headText: {
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    fontSize: 15,
    textAlign: 'center',
    padding: Spacing.xxxl,
  },
});
