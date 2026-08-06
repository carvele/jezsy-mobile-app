import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WardrobeStats } from '@/src/utils/outfitGenerator';

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
                backgroundColor: isActive ? colors.tint : colors.card,
                borderColor: isActive ? colors.tint : colors.border,
              },
            ]}
            onPress={() => onSelect?.(cell.key)}
            disabled={!onSelect}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${cell.value} ${cell.label}`}
          >
            <Text style={[styles.value, { color: isActive ? '#0D0D0D' : colors.text }]}>{cell.value}</Text>
            <Text
              style={[styles.label, { color: isActive ? '#0D0D0D' : colors.secondaryText }]}
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
    gap: 10,
    marginBottom: 16,
  },
  cell: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
