import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WardrobeStats } from '@/src/utils/outfitGenerator';
import { tapLight } from '@/src/utils/haptics';

interface Props {
  stats: WardrobeStats;
  // Tapping a stat filters the grid to it, so the numbers are a way in rather
  // than decoration.
  onSelect?: (filter: 'all' | 'never' | 'neglected') => void;
  active?: 'all' | 'never' | 'neglected';
}

export function WardrobeStatsBar({ stats, onSelect, active = 'all' }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  if (stats.total === 0) return null;

  const cells: { key: 'all' | 'never' | 'neglected'; value: number; label: string }[] = [
    { key: 'all', value: stats.total, label: 'Items' },
    { key: 'never', value: stats.neverWorn, label: 'Never worn' },
    { key: 'neglected', value: stats.neglected, label: 'Not worn 60d' },
  ];

  return (
    <View style={styles.row}>
      {cells.map((cell) => {
        const isActive = active === cell.key;
        return (
          <TouchableOpacity
            key={cell.key}
            style={[
              styles.cell,
              {
                backgroundColor: isActive ? colors.tint : (theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'),
                borderColor: isActive ? colors.tint : colors.border,
              },
            ]}
            onPress={() => { tapLight(); onSelect?.(cell.key); }}
            disabled={!onSelect}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${cell.value} ${cell.label}`}
          >
            <Text style={[styles.value, { color: isActive ? colors.onTint : colors.text }]}>{cell.value}</Text>
            <Text
              style={[styles.label, { color: isActive ? colors.onTint : colors.secondaryText }]}
              numberOfLines={1}
            >
              {cell.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: Spacing.sm,
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
