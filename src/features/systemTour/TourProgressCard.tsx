import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TOUR_MODULE_IDS, TOUR_MODULES } from './tourConfig';
import { TourProgressSnapshot } from './tourProgress';

interface TourProgressCardProps {
  progress: TourProgressSnapshot;
  onContinue: () => void;
  onDismiss: () => void;
}

/**
 * Replaces repeatedly reopening the full modal: after the first login, an
 * unfinished tour surfaces as this compact checklist instead, and the user
 * decides when to continue.
 */
export function TourProgressCard({ progress, onContinue, onDismiss }: TourProgressCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const completedCount = TOUR_MODULE_IDS.filter((id) => progress[id]?.completed).length;
  if (completedCount === TOUR_MODULE_IDS.length) return null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>
          Getting started — {completedCount} of {TOUR_MODULE_IDS.length} complete
        </Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss getting started card">
          <IconSymbol name="xmark" size={16} color={colors.icon} />
        </TouchableOpacity>
      </View>

      <View style={styles.list}>
        {TOUR_MODULE_IDS.map((id) => {
          const done = !!progress[id]?.completed;
          return (
            <View key={id} style={styles.listItem}>
              <IconSymbol
                name={done ? 'checkmark.circle.fill' : 'checkmark.circle'}
                size={16}
                color={done ? colors.tint : colors.secondaryText}
              />
              <Text style={[styles.listItemText, { color: done ? colors.secondaryText : colors.text }]}>
                {TOUR_MODULES[id].title}
              </Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.continueBtn, { backgroundColor: colors.tint }]}
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel="Continue tour"
      >
        <Text style={[styles.continueBtnText, { color: colors.onTint }]}>Continue tour</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    marginRight: Spacing.sm,
  },
  list: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  listItemText: {
    fontSize: 13,
  },
  continueBtn: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: 10,
  },
  continueBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
