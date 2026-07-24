// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

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
  'chevron.left.forwardslash.chevron.right': 'code',
  'arrow.left': 'arrow-back',
  'arrow.up.arrow.down': 'swap-vert',
  'xmark': 'close',

  // Messaging & Communication
  'paperplane.fill': 'send',
  'arrow.up.circle.fill': 'send',
  'envelope.fill': 'email',

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

  // Actions
  'plus': 'add',
  'checkmark': 'check',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.circle.fill': 'check-circle',
  'xmark.circle': 'cancel',
  'trash.fill': 'delete',
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

  // Wardrobe & Fashion
  'tshirt': 'checkroom',
  'hanger': 'checkroom',
  'sparkles': 'auto-awesome',
  'ruler.fill': 'straighten',

  // Calendar & Time
  'calendar': 'calendar-today',
  'calendar.badge.exclamationmark': 'event-busy',
  'clock.arrow.circlepath': 'history',
  'arrow.clockwise': 'refresh',

  // Charts & Data
  'chart.bar.fill': 'bar-chart',
  'slider.horizontal.3': 'tune',

  // Misc
  'heart': 'favorite-border',
  'heart.fill': 'favorite',
  'star': 'star-outline',
  'star.fill': 'star',
  'magnifyingglass': 'search',
  'archivebox': 'archive',
  'cloud.fill': 'cloud',
  'flame.fill': 'local-fire-department',
} as IconMapping;

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
