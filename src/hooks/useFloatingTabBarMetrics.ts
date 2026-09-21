import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Geometry of the floating pill tab bar in app/(tabs)/_layout.tsx.
 *
 * The bar is absolutely positioned and floats above the true screen bottom
 * (clearing the system gesture pill / 3-button nav), so anything else that
 * also anchors to the screen bottom on a tab screen -- like a coachmark
 * banner -- renders underneath it unless it adds this same clearance.
 * Centralised here so the two places computing "where does the bar sit"
 * can't drift apart.
 */
export function useFloatingTabBarMetrics() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isCompact = windowWidth < 360;

  const barBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 16 : 8) + 6;
  const barHeight = isCompact ? 60 : 68;

  return { barBottom, barHeight, isCompact, clearance: barBottom + barHeight };
}

/**
 * Global layout contract for scrollable screens.
 * Returns the bottom padding required to clear the floating tab bar
 * plus some breathing room, ensuring content isn't obscured.
 */
export function useSharedBottomInset() {
  const { clearance } = useFloatingTabBarMetrics();
  return clearance + 24;
}
