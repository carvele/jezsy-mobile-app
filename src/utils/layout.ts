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

  // SSR / pre-hydration: pin to a standard mobile width to match the server render.
  const effectiveWidth = mounted ? width : 400;

  // Phones get 2 cols, small tablets 3, large tablets/web 4+
  const columns = effectiveWidth > 1200 ? 5 : effectiveWidth > 900 ? 4 : effectiveWidth > 600 ? 3 : 2;

  // Hand-picked percentages (e.g. '47%' for 2 columns) don't actually leave
  // room for GRID_COLUMN_GAP: 2 * 47% = 94% of the content box, plus a fixed
  // 20px gap, comes out to just over 100% on a real 375px phone width --
  // enough to trip flexWrap and collapse the grid to a single column. Percent
  // widths and a fixed-pixel gap don't compose the way "leaves easily fits"
  // implies. Computing an exact pixel width instead (floored, so rounding
  // can only leave slack, never overflow) mathematically guarantees columns
  // fit regardless of gap/gutter values.
  const isWeb = Platform.OS === 'web';
  const webScrollbarSlack = isWeb ? 16 : 0;
  const contentWidth = effectiveWidth - GRID_GUTTER * 2 - GRID_COLUMN_GAP * (columns - 1) - webScrollbarSlack;
  
  // Subtract 1px to provide slack for Android's Yoga layout engine, which
  // often wraps exact-fit flex items due to floating point inaccuracies.
  const cardWidth: DimensionValue = Math.floor(contentWidth / columns) - 1;

  return { cardWidth, columns };
}
