import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Database } from '@/src/types/database.types';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useRouter } from 'expo-router';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

interface GapAnalysisProps {
  items: WardrobeItem[];
}

export function GapAnalysis({ items }: GapAnalysisProps) {
  const [expanded, setExpanded] = useState(false);
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const router = useRouter();

  const analysis = useMemo(() => {
    const counts: Record<string, number> = {
      'Top': 0,
      'Bottom': 0,
      'Dress': 0,
      'Outerwear': 0,
      'Shoes': 0,
      'Accessory': 0,
      'Uncategorized': 0,
    };

    items.forEach(item => {
      const type = item.garment_type || 'Uncategorized';
      if (counts[type] !== undefined) {
        counts[type]++;
      } else {
        counts['Uncategorized']++;
      }
    });

    const hasTopHalf = counts['Top'] > 0 || counts['Dress'] > 0;
    const hasBottomHalf = counts['Bottom'] > 0 || counts['Dress'] > 0;

    const gaps = [];
    if (hasTopHalf && counts['Bottom'] === 0 && counts['Dress'] === 0) {
      gaps.push({ message: "You have tops but no bottoms or dresses.", suggest: "Bottom" });
    }
    if (hasBottomHalf && counts['Top'] === 0 && counts['Dress'] === 0) {
      gaps.push({ message: "You have bottoms but no tops or dresses.", suggest: "Top" });
    }
    if (items.length > 5 && counts['Outerwear'] === 0) {
      gaps.push({ message: "Missing outerwear for layering.", suggest: "Outerwear" });
    }
    if (items.length > 3 && counts['Shoes'] === 0) {
      gaps.push({ message: "Don't forget to add shoes!", suggest: "Shoes" });
    }

    return { counts, gaps };
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Toggle wardrobe insights"
      >
        <View style={styles.headerLeft}>
          <IconSymbol name="sparkles" size={15} color={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>Wardrobe Insights</Text>
          {analysis.gaps.length > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.tint + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.tint }]}>
                {analysis.gaps.length} {analysis.gaps.length === 1 ? 'tip' : 'tips'}
              </Text>
            </View>
          )}
        </View>
        <IconSymbol
          name={expanded ? 'chevron.up' : 'chevron.down'}
          size={13}
          color={colors.secondaryText}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.statsRow}>
            {Object.entries(analysis.counts)
              .filter(([cat, count]) => count > 0 && cat !== 'Uncategorized')
              .map(([cat, count]) => (
                <View key={cat} style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                  <Text style={[styles.statValue, { color: colors.tint }]}>{count}</Text>
                  <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{cat}s</Text>
                </View>
              ))}
          </View>

          {analysis.counts['Uncategorized'] > 0 && (
            <Text style={[styles.uncategorizedNote, { color: colors.secondaryText }]}>
              {analysis.counts['Uncategorized']} item{analysis.counts['Uncategorized'] !== 1 ? 's' : ''} missing a category.
            </Text>
          )}

          {analysis.gaps.length > 0 && (
            <View style={[styles.gapsContainer, { borderTopColor: colors.border }]}>
              {analysis.gaps.map((gap, index) => (
                <View key={index} style={[styles.gapItem, { backgroundColor: isDark ? 'rgba(201, 169, 110, 0.08)' : 'rgba(201, 169, 110, 0.12)' }]}>
                  <Text style={[styles.gapMessage, { color: colors.text }]}>{gap.message}</Text>
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: colors.tint }]}
                    onPress={() => router.push('/(tabs)/explore')}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.actionText, { color: colors.onTint }]}>Shop {gap.suggest}s</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  expandedContent: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
  },
  uncategorizedNote: {
    fontSize: 11,
    marginBottom: Spacing.sm,
    fontStyle: 'italic',
  },
  gapsContainer: {
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    gap: 6,
  },
  gapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: Radius.sm,
  },
  gapMessage: {
    fontSize: 12,
    flex: 1,
    marginRight: Spacing.sm,
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '700',
  }
});
