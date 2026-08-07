/**
 * JezSy Collection Premium Theme
 * Fusion of Spotify (Immersive Dark), Uniqlo (Minimalist), and Shopee (Vibrant Accents)
 */

import { Platform } from 'react-native';

// Luxury Gold. The light-mode variant is deliberately darker than the dark-mode
// one: the brighter #C9A96E fails WCAG AA contrast (~2:1) as text on a white
// background, so light mode uses a deepened antique gold (~4.8:1 on #FFFFFF)
// while dark mode keeps the brighter gold (high contrast on near-black).
const tintColorLight = '#8A6D3B'; // Deep antique gold — AA-compliant on white
const tintColorDark = '#C9A96E';  // Luxury Gold

// Blush, from the brand mark's pink heart and bow. Split the same way as gold
// and for the same reason: the soft logo pink (~1.6:1 on white) is only usable
// as a fill, so text and icons on light backgrounds use a deepened rose.
const blushFill = '#E8B4C4';      // Decorative fills, badges, dark-mode icons
const blushTextLight = '#A94F66'; // Deepened rose — AA-compliant on white

export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    tint: tintColorLight,
    // Text and icons sitting ON a tint-filled surface. Near-black on the
    // light gold measures 4.01:1 and fails AA; white measures 4.85:1 and
    // passes. Dark mode is the reverse, hence a per-scheme token rather than
    // one hardcoded value.
    onTint: '#FFFFFF',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    card: '#F3F4F6',
    border: '#E5E7EB',
    notification: '#F72585',
    secondaryText: '#6B7280',
    accent: '#C9A96E', // Brighter gold kept for decorative fills (not text)
    // Brand blush. `blush` is safe as text/icon on light; `blushFill` is the
    // logo pink, for fills and backgrounds only.
    blush: blushTextLight,
    blushFill,
    surface: '#F9FAFB',
    // Semantic status colors (AA-compliant as text on light backgrounds)
    success: '#0F8A5F',
    warning: '#B45309',
    error: '#DC2626',
    info: '#2563EB',
    imagePlaceholder: '#E5E7EB',
  },
  dark: {
    text: '#F5F5F5',
    background: '#0D0D0D', // Spotify-like Rich Black
    tint: tintColorDark,
    onTint: '#0D0D0D', // 8.70:1 on the brighter dark-mode gold
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    card: '#1A1A2E', // Deep Navy card bg
    border: '#2D2D44',
    notification: '#F72585', // Vibrant pink for badges/sales
    secondaryText: '#9CA3AF',
    accent: '#E8D5B7', // Soft Champagne
    // On near-black the logo pink has ample contrast, so it is used directly --
    // this is the palette the brand mark itself sits in.
    blush: blushFill,
    blushFill,
    surface: '#16213E', // Elevated surfaces
    // Semantic status colors (tuned for contrast on dark backgrounds)
    success: '#06D6A0',
    warning: '#FFB703',
    error: '#EF476F',
    info: '#4CC9F0',
    imagePlaceholder: '#2A2A2A',
  },
};

/**
 * Spacing scale (4pt base). Use these instead of ad-hoc padding/margin values
 * so vertical rhythm stays consistent across screens.
 */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/**
 * Corner-radius scale. `pill` is for fully-rounded buttons/badges.
 */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Type scale: size, weight, line height and tracking together, because a size
 * on its own is not a typographic style. Line heights follow the usual ratios
 * -- roughly 1.5x for body copy so paragraphs breathe, tightening toward 1.15x
 * for display sizes where generous leading reads as loose rather than airy.
 *
 * Tracking moves the other way: negative on large text (big type set at normal
 * spacing looks gappy), positive on small uppercase labels, where letterforms
 * need room to stay legible.
 */
export const Type = {
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16, letterSpacing: 0 },
  label: { fontSize: 11, fontWeight: '700' as const, lineHeight: 14, letterSpacing: 1 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 21, letterSpacing: 0 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22, letterSpacing: 0 },
  subtitle: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24, letterSpacing: -0.2 },
  title: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26, letterSpacing: -0.3 },
  headline: { fontSize: 24, fontWeight: '800' as const, lineHeight: 30, letterSpacing: -0.4 },
  display: { fontSize: 32, fontWeight: '800' as const, lineHeight: 37, letterSpacing: -0.6 },
} as const;

/**
 * Elevation. Shadows were previously written inline per screen with differing
 * opacities and radii, so cards at the same conceptual depth cast different
 * shadows. Android reads `elevation` only; iOS reads the shadow triple.
 */
export const Elevation = {
  none: Platform.select({ ios: {}, default: { elevation: 0 } }),
  sm: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3 },
    default: { elevation: 2 },
  }),
  md: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8 },
    default: { elevation: 5 },
  }),
  lg: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16 },
    default: { elevation: 10 },
  }),
} as const;

/**
 * Motion. Durations short enough to feel responsive rather than animated --
 * anything past ~300ms on a tap reads as lag, not polish.
 */
export const Motion = {
  fast: 140,
  base: 220,
  slow: 320,
  /** Per-item delay for staggered list entrances; kept small so long lists do not crawl. */
  stagger: 40,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    serif: 'Georgia',
    rounded: 'System',
    mono: 'Courier',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});
