import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, Spacing, Radius, Type, Elevation } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { tapMedium } from '@/src/utils/haptics';

export interface ErrorRetryStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
  testID?: string;
}

/**
 * Standard error state honoring the 4-state contract (UX-FOUND-002).
 * Displays a distinct failure indicator and a clear Retry action.
 * Never masquerades as an empty state.
 */
export function ErrorRetryState({
  title = 'Something went wrong',
  message = "We couldn't load this information. Please check your connection and try again.",
  onRetry,
  retryLabel = 'Try Again',
  isRetrying = false,
  testID = 'error-retry-state',
}: ErrorRetryStateProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <View style={styles.container} testID={testID}>
      <View style={[styles.iconCircle, { backgroundColor: colors.error + '15', borderColor: colors.error + '40' }]}>
        <IconSymbol name="exclamationmark.triangle.fill" size={40} color={colors.error} />
      </View>

      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>

      <Text style={[styles.message, { color: colors.secondaryText }]}>
        {message}
      </Text>

      {onRetry && (
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.tint, opacity: isRetrying ? 0.7 : 1 }]}
          onPress={() => {
            if (!isRetrying) {
              tapMedium();
              onRetry();
            }
          }}
          disabled={isRetrying}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <View style={styles.buttonContent}>
              <IconSymbol name="arrow.clockwise" size={18} color="#FFFFFF" />
              <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>{retryLabel}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    ...Elevation.sm,
  },
  title: {
    ...Type.headline,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  message: {
    ...Type.body,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    maxWidth: 320,
    lineHeight: 22,
  },
  retryButton: {
    height: 48,
    paddingHorizontal: Spacing.xxl,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 160,
    ...Elevation.md,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  retryButtonText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
});
