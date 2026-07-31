import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

const PLACEHOLDER = require('@/assets/images/partial-react-logo.png');
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// The grid card needs BOTH dimensions as real numbers. Every child here is
// absolutely positioned, so the card has no in-flow content to give it a
// height -- and aspectRatio does not resolve one inside the wrapping flex row
// the grid uses, so the card collapsed and the whole Categories section
// rendered blank. (The rail variant gets away with aspectRatio because it
// lives in a horizontal ScrollView.) Height is derived from the width to keep
// the intended 3:2 landscape shape.
// 16 = the grid's page padding each side, 12 = the gutter between columns.
const GRID_CARD_WIDTH = (SCREEN_WIDTH - 16 * 2 - 12) / 2;
const GRID_CARD_HEIGHT = GRID_CARD_WIDTH / (3 / 2);

export type CategoryCardVariant = 'grid' | 'rail';

type Props = {
  category: { id: string; name: string; image_url?: string | null };
  variant?: CategoryCardVariant;
  onPress: () => void;
};

export function CategoryCard({ category, variant = 'grid', onPress }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isRail = variant === 'rail';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isRail ? styles.cardRail : styles.cardGrid,
        { backgroundColor: colors.imagePlaceholder },
      ]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${category.name}`}
      accessibilityHint="Opens this category"
    >
      <Image
        source={category.image_url ? { uri: category.image_url } : PLACEHOLDER}
        style={styles.image}
        contentFit="cover"
      />

      {/* A bottom-anchored gradient rather than a flat scrim over the whole
          card. The old 35% black wash muted the photograph everywhere and the
          label still needed a text shadow to stay readable; this keeps the top
          of the image at full contrast and puts the darkness only where the
          text actually sits. */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
        locations={[0, 0.45, 1]}
        style={styles.scrim}
      />

      <View style={[styles.textRow, isRail ? styles.textRowRail : styles.textRowGrid]}>
        <Text
          style={[styles.name, isRail ? styles.nameRail : styles.nameGrid]}
          numberOfLines={2}
        >
          {category.name}
        </Text>
        {/* Small navigational cue: these look like posters otherwise, with
            nothing saying they lead somewhere. */}
        <IconSymbol name="chevron.right" size={isRail ? 14 : 12} color="rgba(255,255,255,0.85)" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  // Aspect ratios rather than fixed pixel heights, so the shape holds on a
  // narrow phone as well as a tablet. Both are landscape-ish on purpose: as
  // portrait posters, ten categories cost roughly three screens of scrolling
  // before any product was visible.
  cardGrid: { width: GRID_CARD_WIDTH, height: GRID_CARD_HEIGHT },
  cardRail: { width: SCREEN_WIDTH * 0.42, aspectRatio: 4 / 3 },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  textRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  textRowGrid: { paddingHorizontal: 10, paddingBottom: 10 },
  textRowRail: { paddingHorizontal: 12, paddingBottom: 12 },
  // Left-aligned at the base, the editorial convention, instead of floated in
  // the dead centre of a dimmed rectangle.
  name: {
    flex: 1,
    color: '#FFF',
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  nameGrid: { fontSize: 12 },
  nameRail: { fontSize: 14, letterSpacing: 1.2 },
});
