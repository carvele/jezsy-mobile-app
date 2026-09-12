import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StylistRecommendation } from '@/src/services/virtualStylistService';

type Props = {
  recommendation: StylistRecommendation | null;
};

/**
 * Renders the three copy states from the Color Recommendation implementation
 * plan. Never claims a size+color combination that isn't actually in stock --
 * every branch here is driven by resolvedVariant, not by topColorRecommendation
 * alone.
 */
export function StylistSummary({ recommendation }: Props) {
  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];

  if (!recommendation?.sizeRecommendation || !recommendation.topColorRecommendation) return null;

  const { sizeRecommendation, topColorRecommendation, resolvedColorRecommendation, resolvedVariant } = recommendation;
  const size = sizeRecommendation.size.toUpperCase();
  const topColorName = topColorRecommendation.colorName;

  let message: string;
  if (resolvedVariant && resolvedColorRecommendation) {
    if (resolvedColorRecommendation.colorKey === topColorRecommendation.colorKey) {
      message = `JezSy recommends: ${size} in ${topColorName}.`;
    } else {
      message = `JezSy recommends: ${size} in ${resolvedColorRecommendation.colorName}. ${topColorName} was your highest match, but ${resolvedColorRecommendation.colorName} is the best color currently available in ${size}.`;
    }
  } else {
    message = `Recommended fit: ${size}. Best color: ${topColorName}. (${topColorName} is currently unavailable in ${size}.)`;
  }

  // Generic mode has no real personalization signal behind it -- showing
  // "recommended for you" framing over a zero-signal, alphabetically-tied
  // fallback would be a false claim.
  const showPersonalizedFraming = recommendation.personalizationMode !== 'generic';

  return (
    <View
      style={[styles.container, { backgroundColor: colors.tint + '10', borderColor: colors.tint + '30' }]}
      accessibilityRole="text"
    >
      <IconSymbol name="sparkles" size={14} color={colors.tint} />
      <Text style={[Type.caption, styles.text, { color: colors.text }]}>
        {showPersonalizedFraming ? message : message.replace(/^JezSy recommends: /, 'Suggested: ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing.xs,
  },
  text: {
    flex: 1,
    lineHeight: 18,
  },
});
