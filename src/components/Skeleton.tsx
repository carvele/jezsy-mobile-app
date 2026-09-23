import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle, DimensionValue, StyleProp } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReduceMotion } from '@/src/hooks/useReduceMotion';
import { useGridCardWidth } from '@/src/utils/layout';

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** A single shimmering placeholder block. */
export function Skeleton({ width = '100%', height, radius = 8, style }: SkeletonProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const pulse = useSharedValue(0.4);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.6;
      return;
    }
    pulse.value = withRepeat(withTiming(0.9, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const hasRatio = (() => {
    if (!style) return false;
    if (Array.isArray(style)) {
      return style.some((s) => s && typeof s === 'object' && 'aspectRatio' in s && s.aspectRatio !== undefined);
    }
    return typeof style === 'object' && 'aspectRatio' in style && style.aspectRatio !== undefined;
  })();

  const resolvedHeight = height !== undefined
    ? height
    : hasRatio
    ? undefined
    : 16;

  return (
    <Animated.View
      style={[
        {
          width,
          ...(resolvedHeight !== undefined ? { height: resolvedHeight } : {}),
          borderRadius: radius,
          backgroundColor: colors.imagePlaceholder,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export type ProductCardSkeletonLayout = 'grid' | 'fill';

export interface ProductCardSkeletonProps {
  width?: DimensionValue;
  layout?: ProductCardSkeletonLayout;
  style?: StyleProp<ViewStyle>;
}

/** Grid card placeholder, matching the Explore/Home product card shape. */
export function ProductCardSkeleton({
  width: customWidth,
  layout = 'grid',
  style,
}: ProductCardSkeletonProps = {}) {
  const { cardWidth } = useGridCardWidth();
  const isFill = layout === 'fill';

  const containerStyle: ViewStyle = isFill
    ? { flexGrow: 1, flexBasis: 0, minWidth: 0, marginBottom: Spacing.xl }
    : { width: customWidth ?? cardWidth, marginBottom: Spacing.xl };

  return (
    <View style={[containerStyle, style]}>
      <Skeleton width="100%" radius={12} style={{ aspectRatio: 3 / 4 }} />
      <Skeleton width="80%" height={13} style={{ marginTop: 10 }} />
      <Skeleton width="45%" height={13} style={{ marginTop: 6 }} />
    </View>
  );
}

/** Horizontal row placeholder for list screens (reservations, orders, messages). */
export function ListRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={64} height={64} radius={10} />
      <View style={styles.rowBody}>
        <Skeleton width="70%" height={15} />
        <Skeleton width="45%" height={13} style={{ marginTop: Spacing.sm }} />
        <Skeleton width="30%" height={12} style={{ marginTop: Spacing.sm }} />
      </View>
    </View>
  );
}

/** Renders n copies of a skeleton, for filling a list or grid while loading. */
export function SkeletonList({ count = 5, children }: { count?: number; children: React.ReactElement }) {
  return <>{Array.from({ length: count }, (_, i) => React.cloneElement(children, { key: i }))}</>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
  },
});
