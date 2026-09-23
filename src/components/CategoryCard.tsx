import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useGridCardWidth } from '@/src/utils/layout';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Page padding and column gutter come from the shared grid tokens rather than
// being restated here, so retokenising the screen's padding resizes the card
// instead of breaking the two-column layout.

const GRID_CARD_ASPECT = 1.5;

export type CategoryCardVariant = 'grid' | 'rail';
export type CategoryCardLayout = 'grid' | 'fill';

type Props = {
  category: { id: string; name: string; image_url?: string | null };
  variant?: CategoryCardVariant;
  layout?: CategoryCardLayout;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
};

export function CategoryCard({
  category,
  variant = 'grid',
  layout = 'grid',
  style,
  onPress,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isRail = variant === 'rail';
  const { cardWidth } = useGridCardWidth();
  // Every child of the card is absolutely positioned, so its height comes only
  // from the aspect ratio. Inside the wrapping grid row, Android collapsed that
  // to zero and the whole Explore category grid vanished. An explicit height
  // removes the dependency on aspectRatio resolution.
  const gridStyle =
    typeof cardWidth === 'number'
      ? { width: cardWidth, height: Math.round(cardWidth / GRID_CARD_ASPECT) }
      : { width: cardWidth, aspectRatio: GRID_CARD_ASPECT };

  const variantStyle = isRail
    ? styles.cardRail
    : layout === 'fill'
    ? [styles.cardFill, { aspectRatio: GRID_CARD_ASPECT }]
    : [styles.cardGrid, gridStyle];

  return (
    <TouchableOpacity
      style={[
        styles.card,
        variantStyle,
        { backgroundColor: colors.imagePlaceholder },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${category.name}`}
      accessibilityHint="Opens this category"
    >
      {/* No image is better than the wrong one: this used to fall back to the
          Expo template's React logo, which read as a broken tile. A category
          without a photo now shows a plain tinted card with its name. */}
      {category.image_url ? (
        <Image source={{ uri: category.image_url }} style={styles.image} contentFit="cover" />
      ) : null}

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
  cardGrid: {},
  cardFill: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  cardRail: { width: SCREEN_WIDTH * 0.42, aspectRatio: 4 / 3 },
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  textRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  textRowGrid: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  textRowRail: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  // Left-aligned at the base, the editorial convention, instead of floated in
  // the dead centre of a dimmed rectangle.
  name: {
    flex: 1,
    color: '#FFF',
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  nameGrid: { fontSize: 12, letterSpacing: 0.9 },
  nameRail: { fontSize: 14, letterSpacing: 1.2 },
});
