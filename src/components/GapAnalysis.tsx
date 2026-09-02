import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Database } from '@/src/types/database.types';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useRouter } from 'expo-router';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

interface GapAnalysisProps {
  items: WardrobeItem[];
}

export function GapAnalysis({ items }: GapAnalysisProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const router = useRouter();

  const analysis = useMemo(() => {
    // Bucket by garment_type (Top/Bottom/Dress/Outerwear/Shoes/Accessory),
    // not the free-text boutique `category` -- those are two different
    // fields (e.g. category might be "Evening Wear", garment_type "Dress").
    // Items added before garment_type existed fall into 'Uncategorized'.
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

    // A dress covers "top+bottom" for outfit-completeness purposes.
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
    return (
      <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <IconSymbol name="sparkles" size={32} color={colors.tint} />
        <Text style={[styles.title, { color: colors.text, marginTop: Spacing.md }]}>Wardrobe Insights</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Add some items to get personalized recommendations and gap analysis.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <IconSymbol name="chart.bar.fill" size={24} color={colors.tint} />
        <Text style={[styles.title, { color: colors.text }]}>Wardrobe Insights</Text>
      </View>

      <View style={styles.statsRow}>
        {Object.entries(analysis.counts)
          .filter(([cat, count]) => count > 0 && cat !== 'Uncategorized')
          .map(([cat, count]) => (
            <View key={cat} style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
              <Text style={[styles.statValue, { color: colors.tint }]}>{count}</Text>
              <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{cat}s</Text>
            </View>
          ))}
      </View>

      {analysis.counts['Uncategorized'] > 0 && (
        <Text style={[styles.uncategorizedNote, { color: colors.secondaryText }]}>
          {analysis.counts['Uncategorized']} item{analysis.counts['Uncategorized'] !== 1 ? 's' : ''} missing a type and left out of insights above -- edit them to add one.
        </Text>
      )}

      {analysis.gaps.length > 0 && (
        <View style={[styles.gapsContainer, { borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
          <Text style={[styles.gapsTitle, { color: colors.text }]}>Suggestions</Text>
          {analysis.gaps.map((gap, index) => (
            <View key={index} style={[styles.gapItem, { backgroundColor: 'rgba(201, 169, 110, 0.1)' }]}>
              <Text style={[styles.gapMessage, { color: colors.text }]}>{gap.message}</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/(tabs)/explore')}
              >
                <Text style={[styles.actionText, { color: colors.onTint }]}>Shop {gap.suggest}s</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.xl,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  title: {
    ...Type.subtitle,
  },
  subtitle: {
    fontSize: 14,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
  },
  statValue: {
    ...Type.subtitle,
  },
  statLabel: {
    fontSize: 12,
    marginTop: Spacing.xs,
  },
  uncategorizedNote: {
    fontSize: 12,
    marginBottom: Spacing.lg,
    fontStyle: 'italic',
  },
  gapsContainer: {
    borderTopWidth: 1,
    paddingTop: Spacing.lg,
  },
  gapsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  gapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  gapMessage: {
    fontSize: 14,
    flex: 1,
    marginRight: Spacing.md,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
  },
  actionText: {
    
    fontSize: 12,
    fontWeight: '700',
  }
});
