/**
 * JezSy Collection Premium Theme
 * Fusion of Spotify (Immersive Dark), Uniqlo (Minimalist), and Shopee (Vibrant Accents)
 */

import { Platform } from 'react-native';

const tintColorLight = '#C9A96E'; // Luxury Gold
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
    accent: '#C9A96E',
    surface: '#F9FAFB',
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
  },
};

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
