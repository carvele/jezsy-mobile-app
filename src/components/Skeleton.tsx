import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle, DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** A single shimmering placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.9, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.imagePlaceholder },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Grid card placeholder, matching the Explore/Home product card shape. */
export function ProductCardSkeleton({ width = 160 }: { width?: number }) {
  return (
    <View style={{ width, marginBottom: 20 }}>
      <Skeleton width={width} height={width * 1.3} radius={12} />
      <Skeleton width={width * 0.8} height={13} style={{ marginTop: 10 }} />
      <Skeleton width={width * 0.45} height={13} style={{ marginTop: 6 }} />
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
        <Skeleton width="45%" height={13} style={{ marginTop: 8 }} />
        <Skeleton width="30%" height={12} style={{ marginTop: 8 }} />
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
