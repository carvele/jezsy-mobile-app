import { Platform, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';

export function HapticTab(props: any) {
  const { onPress, onPressIn, ...rest } = props;

  const handlePress = (e: any) => {
    if (Platform.OS === 'web' && e) {
      // Prevent browser from doing a hard anchor navigation so React Navigation
      // handles the tab transition purely in-memory with zero white flash.
      const hasModifier = e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || (e.button != null && e.button !== 0);
      if (!hasModifier) {
        e.preventDefault?.();
      }
    }
    onPress?.(e);
  };

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPressIn?.(ev);
      }}
    />
  );
}
