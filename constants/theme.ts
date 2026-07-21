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

export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    card: '#F3F4F6',
    border: '#E5E7EB',
    notification: '#F72585',
    secondaryText: '#6B7280',
    accent: '#C9A96E', // Brighter gold kept for decorative fills (not text)
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
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    card: '#1A1A2E', // Deep Navy card bg
    border: '#2D2D44',
    notification: '#F72585', // Vibrant pink for badges/sales
    secondaryText: '#9CA3AF',
    accent: '#E8D5B7', // Soft Champagne
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
 * Type scale (size + a sensible default weight). Screens may override weight,
 * but sizes should come from here to avoid the current 10/11/13/18/20/24/32 drift.
 */
export const Type = {
  caption: { fontSize: 12, fontWeight: '500' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1 },
  body: { fontSize: 14, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  subtitle: { fontSize: 18, fontWeight: '700' as const },
  title: { fontSize: 20, fontWeight: '700' as const },
  headline: { fontSize: 24, fontWeight: '800' as const },
  display: { fontSize: 32, fontWeight: '800' as const },
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
