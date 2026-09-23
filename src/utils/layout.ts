import { useEffect, useState } from 'react';
import { DimensionValue, useWindowDimensions, Platform } from 'react-native';
import { Spacing } from '@/constants/theme';

/**
 * Shared geometry for the two-column product and category grids.
 *
 * ProductCard and CategoryCard each computed their own width from literals
 * that were really the *screens'* padding -- Explore's page padding and column
 * gutter, and Home's grid padding. Two components encoded three screens'
 * layout, so retokenising any one of those paddings silently resized or
 * collapsed a grid. Both cards and all three screens now read the same
 * constants, which makes the padding a token rather than a magic number.
 */

/** Page padding on each side of a grid. */
export const GRID_GUTTER = Spacing.xxxl; // 32

/** Space between columns. */
export const GRID_COLUMN_GAP = Spacing.xl; // 20

/** Usable width for one card in an evenly-divided grid.
 *
 * Uses a `mounted` guard so the server-render and first hydration pass always
 * emit the same 2-column layout (effectiveWidth = 400). After mount the hook
 * re-runs with the real window width and switches to the correct column count.
 * Without this guard, useWindowDimensions returns different values on the
 * server vs. client, which triggers React hydration error #418.
 */


export function useGridCardWidth(): { cardWidth: DimensionValue; columns: number } {
  const { width } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isWeb = Platform.OS === 'web';
  const webClientWidth =
    isWeb && typeof document !== 'undefined' && document.documentElement?.clientWidth
      ? document.documentElement.clientWidth
      : null;

  // SSR / pre-hydration: pin to a standard mobile width to match the server render.
  const effectiveWidth = mounted ? (webClientWidth || width) : 400;

  // Phones get 2 cols, small tablets 3, large tablets/web 4+
  const columns = effectiveWidth > 1200 ? 5 : effectiveWidth > 900 ? 4 : effectiveWidth > 600 ? 3 : 2;

  // Computing an exact pixel width mathematically guarantees columns
  // fit regardless of gap/gutter values.
  const contentWidth = effectiveWidth - GRID_GUTTER * 2 - GRID_COLUMN_GAP * (columns - 1);
  
  // Subtract 1px on Android to provide slack for Yoga layout engine, which
  // often wraps exact-fit flex items due to floating point inaccuracies.
  const yogaSlack = Platform.OS === 'android' ? 1 : 0;
  const cardWidth: DimensionValue = Math.floor(contentWidth / columns) - yogaSlack;

  return { cardWidth, columns };
}

/** Page padding on each side of the wardrobe garments grid. */
export const WARDROBE_GRID_GUTTER = Spacing.md; // 16

/** Space between columns in the wardrobe garments grid. */
export const WARDROBE_GRID_COLUMN_GAP = Spacing.sm; // 8

/** Usable width for one card in the 3-column wardrobe garments grid. */
export function useWardrobeGridCardWidth(): { cardWidth: DimensionValue; columns: number } {
  const { width } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isWeb = Platform.OS === 'web';
  const webClientWidth =
    isWeb && typeof document !== 'undefined' && document.documentElement?.clientWidth
      ? document.documentElement.clientWidth
      : null;

  const effectiveWidth = mounted ? (webClientWidth || width) : 400;

  // Phones get 3 cols to maximize screen space; tablets/web scale up
  const columns = effectiveWidth > 1200 ? 6 : effectiveWidth > 900 ? 5 : effectiveWidth > 600 ? 4 : 3;

  const contentWidth = effectiveWidth - WARDROBE_GRID_GUTTER * 2 - WARDROBE_GRID_COLUMN_GAP * (columns - 1);
  const yogaSlack = Platform.OS === 'android' ? 1 : 0.5;
  const cardWidth: DimensionValue = Math.floor(contentWidth / columns) - yogaSlack;

  return { cardWidth, columns };
}
