import { Dimensions } from 'react-native';
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

/** Usable width for one card in an evenly-divided grid. */
export function gridCardWidth(columns = 2): number {
  const gaps = GRID_COLUMN_GAP * (columns - 1);
  return (SCREEN_WIDTH - GRID_GUTTER * 2 - gaps) / columns;
}
