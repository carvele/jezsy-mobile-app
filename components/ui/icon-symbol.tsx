// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, Platform, type StyleProp, type TextStyle } from 'react-native';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const fontId = 'expo-material-icons-web';
  if (!document.getElementById(fontId)) {
    const link = document.createElement('link');
    link.id = fontId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    document.head.appendChild(link);
  }
}

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>['name']>;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation
  'house.fill': 'home',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  'chevron.down': 'expand-more',
  'chevron.up': 'expand-less',
  'chevron.left.forwardslash.chevron.right': 'code',
  'arrow.left': 'arrow-back',
  'arrow.up.arrow.down': 'swap-vert',
  'xmark': 'close',

  // Messaging & Communication
  'paperplane.fill': 'send',
  'arrow.up.circle.fill': 'send',
  'envelope.fill': 'email',
  'bubble.left.and.bubble.right': 'forum',

  // Commerce & Shopping
  'bag': 'shopping-bag',
  'bag.fill': 'shopping-bag',
  'bag.badge.plus': 'add-shopping-cart',
  'tag.fill': 'local-offer',

  // Media & Camera
  'camera': 'camera-alt',
  'camera.fill': 'camera-alt',
  'camera.viewfinder': 'center-focus-strong',
  'qrcode.viewfinder': 'qr-code-scanner',
  'photo.fill': 'photo',
  'cube.transparent': 'view-in-ar',
  'cube.fill': 'view-in-ar',

  // Actions
  'plus': 'add',
  'minus': 'remove',
  'checkmark': 'check',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.circle.fill': 'check-circle',
  'xmark.circle': 'cancel',
  'xmark.circle.fill': 'cancel',
  'trash.fill': 'delete',
  'trash': 'delete',
  'square.and.arrow.up': 'share',
  'delete.left': 'backspace',

  // Status & Alerts
  'bell': 'notifications-none',
  'bell.fill': 'notifications',
  'bell.slash': 'notifications-off',
  'exclamationmark.circle': 'error-outline',
  'exclamationmark.triangle.fill': 'warning',
  'info.circle.fill': 'info',

  // User & Profile
  'person.fill': 'person',
  'lock.fill': 'lock',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility-off',
  'gear': 'settings',
  'questionmark.circle': 'help-outline',
  'questionmark.circle.fill': 'help',
  'checkmark.seal.fill': 'verified',

  // Wardrobe & Fashion
  'tshirt': 'checkroom',
  'tshirt.fill': 'checkroom',
  'hanger': 'checkroom',
  'sparkles': 'auto-awesome',
  'ruler.fill': 'straighten',

  // Calendar & Time
  'calendar': 'calendar-today',
  'calendar.badge.exclamationmark': 'event-busy',
  'clock.arrow.circlepath': 'history',
  'arrow.clockwise': 'refresh',
  'shuffle': 'shuffle',

  // Charts & Data
  'chart.bar.fill': 'bar-chart',
  'slider.horizontal.3': 'tune',

  // Appearance
  'moon.fill': 'dark-mode',
  'sun.max.fill': 'light-mode',
  'circle.lefthalf.filled': 'contrast',

  // Payment
  'creditcard': 'credit-card',

  // Misc
  'heart': 'favorite-border',
  'heart.fill': 'favorite',
  'star': 'star-outline',
  'star.fill': 'star',
  'magnifyingglass': 'search',
  'archivebox': 'archive',
  'cloud.fill': 'cloud',
  'flame.fill': 'local-fire-department',

  // Body scan preparation. An unmapped name resolves to undefined and renders
  // nothing at all, so every icon used by ScanPrep has to be listed here.
  'eyeglasses': 'face',
  'square.grid.2x2': 'grid-on',
  'shoe': 'directions-walk',
  'lightbulb': 'lightbulb',
  'speaker.wave.2.fill': 'volume-up',
  'figure.stand': 'accessibility-new',
} as const satisfies IconMapping;

type IconSymbolName = keyof typeof MAPPING;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
