import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Radius, Type, Elevation } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LaurelWreath, Sparkle } from './BrandFlourish';
import { tapMedium } from '@/src/utils/haptics';

interface Props {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Empty state carrying the brand's laurel and sparkles.
 *
 * Empty screens are the one place ornament costs nothing -- there is no
 * content for it to compete with, and it turns a dead end into something
 * deliberate.
 */
export function BrandEmptyState({ icon, title, message, actionLabel, onAction }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <View style={styles.wrap}>
      <View style={styles.emblem}>
        <View style={[styles.disc, { backgroundColor: colors.card, borderColor: colors.tint }]}>
          <IconSymbol name={icon} size={44} color={colors.tint} />
        </View>
        <View style={styles.sparkleLeft}>
          <Sparkle size={12} color={colors.tint} opacity={0.9} />
        </View>
        <View style={styles.sparkleRight}>
          <Sparkle size={9} color={colors.blushFill} opacity={0.95} />
        </View>
        <View style={styles.laurel}>
          <LaurelWreath width={168} color={colors.tint} />
        </View>
      </View>

      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text>

      {actionLabel && onAction ? (
        <TouchableOpacity
          style={[styles.action, { backgroundColor: colors.tint }]}
          onPress={() => { tapMedium(); onAction(); }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  emblem: {
    width: 168,
    height: 132,
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  disc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    ...Elevation.sm,
  },
  // The wreath cradles the disc from below, as it does under the wordmark.
  laurel: {
    position: 'absolute',
    bottom: 0,
  },
  sparkleLeft: {
    position: 'absolute',
    left: 22,
    top: 10,
  },
  sparkleRight: {
    position: 'absolute',
    right: 26,
    top: 26,
  },
  title: {
    ...Type.headline,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  message: {
    ...Type.body,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    maxWidth: 300,
  },
  action: {
    height: 52,
    paddingHorizontal: Spacing.xxxl,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    ...Elevation.md,
  },
  actionText: {
    color: '#0D0D0D',
    ...Type.bodyStrong,
    fontWeight: '700',
  },
});
