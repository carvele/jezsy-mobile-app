import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Database } from '@/src/types/database.types';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useRouter } from 'expo-router';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

interface GapAnalysisProps {
  items: WardrobeItem[];
}

export function GapAnalysis({ items }: GapAnalysisProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();

  const analysis = useMemo(() => {
    const counts: Record<string, number> = {
      'Top': 0,
      'Bottom': 0,
      'Outerwear': 0,
      'Shoes': 0,
      'Accessory': 0,
    };

    items.forEach(item => {
      const cat = item.category || 'Other';
      if (counts[cat] !== undefined) {
        counts[cat]++;
      }
    });

    const gaps = [];
    if (counts['Top'] > 0 && counts['Bottom'] === 0) {
      gaps.push({ message: "You have tops but no bottoms.", suggest: "Bottom" });
    }
    if (counts['Bottom'] > 0 && counts['Top'] === 0) {
      gaps.push({ message: "You have bottoms but no tops.", suggest: "Top" });
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
        <Text style={[styles.title, { color: colors.text, marginTop: 12 }]}>Wardrobe Insights</Text>
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
        {Object.entries(analysis.counts).filter(([_, count]) => count > 0).map(([cat, count]) => (
          <View key={cat} style={styles.statChip}>
            <Text style={[styles.statValue, { color: colors.tint }]}>{count}</Text>
            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{cat}s</Text>
          </View>
        ))}
      </View>

      {analysis.gaps.length > 0 && (
        <View style={styles.gapsContainer}>
          <Text style={[styles.gapsTitle, { color: colors.text }]}>Suggestions</Text>
          {analysis.gaps.map((gap, index) => (
            <View key={index} style={[styles.gapItem, { backgroundColor: 'rgba(201, 169, 110, 0.1)' }]}>
              <Text style={[styles.gapMessage, { color: colors.text }]}>{gap.message}</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/(tabs)/explore')}
              >
                <Text style={styles.actionText}>Shop {gap.suggest}s</Text>
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
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  gapsContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 16,
  },
  gapsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  gapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  gapMessage: {
    fontSize: 14,
    flex: 1,
    marginRight: 12,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionText: {
    color: '#0D0D0D',
    fontSize: 12,
    fontWeight: '700',
  }
});
