import { Dimensions, useWindowDimensions } from 'react-native';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** Page padding on each side of a grid. */
export const GRID_GUTTER = Spacing.lg; // 16

/** Space between columns. */
export const GRID_COLUMN_GAP = Spacing.md; // 12

import { useEffect, useState } from 'react';

/** Usable width for one card in an evenly-divided grid. */
export function useGridCardWidth(): { cardWidth: number; columns: number } {
  const { width } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // SSR and pre-hydration: assume mobile (width 0 or small) to prevent hydration mismatches
  const effectiveWidth = mounted ? width : 400;

  // Phones get 2 cols, small tablets 3, large tablets/web 4+
  const columns = effectiveWidth > 1200 ? 5 : effectiveWidth > 900 ? 4 : effectiveWidth > 600 ? 3 : 2;
  const gaps = GRID_COLUMN_GAP * (columns - 1);
  const cardWidth = (effectiveWidth - GRID_GUTTER * 2 - gaps) / columns;
  return { cardWidth, columns };
}
