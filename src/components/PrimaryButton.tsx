import React from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Colors, Radius, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Trailing icon, e.g. the arrow on a multi-step form. */
  icon?: React.ReactNode;
  /**
   * Force the dark palette. The onboarding screens sit on photographs under a
   * dark scrim, so they stay dark regardless of the system theme and a
   * light-mode gold button would be wrong on them.
   */
  dark?: boolean;
  /** Two screens carry a gold glow the others do not; passed in rather than a `glow` flag. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The gold call-to-action.
 *
 * Was hand-rolled in five places with the corner radius drifting across
 * 14/28/30 and five separate disabled variants. Standardised on the pill,
 * which is what the rest of the app already uses at this size.
 */
export function PrimaryButton({ label, onPress, disabled, loading, icon, dark, style }: Props) {
  const scheme = useColorScheme();
  const colors = dark ? Colors.dark : Colors[scheme];
  const inactive = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.tint }, inactive && styles.inactive, style]}
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.onTint} />
      ) : (
        <>
          <Text style={[styles.label, { color: colors.onTint }]}>{label}</Text>
          {icon}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  inactive: {
    opacity: 0.5,
  },
  label: {
    ...Type.bodyStrong,
    ...Type.bodyLargeStrong,
  },
});
