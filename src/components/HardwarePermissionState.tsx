import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Colors, Spacing, Radius, Type, Elevation } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { tapMedium } from '@/src/utils/haptics';
import type { HardwarePermissionStatus } from '@/src/hooks/useHardwarePermission';

export interface HardwarePermissionStateProps {
  status: HardwarePermissionStatus;
  onRequestPermission?: () => void;
  onOpenSettings?: () => void;
  onRetry?: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  featureName?: string;
}

/**
 * Standard hardware permission recovery view (UX-FOUND-005).
 * Distinctly renders:
 * - not_determined / denied_can_ask_again: Prompts for permission
 * - permanently_denied: Directs user to open Settings via Linking.openSettings()
 * - hardware_unavailable: Clear missing hardware explanation (never blames permission)
 * - runtime_error: Driver/runtime failure with Retry action
 */
export function HardwarePermissionState({
  status,
  onRequestPermission,
  onOpenSettings,
  onRetry,
  isLoading = false,
  errorMessage,
  featureName = 'this feature',
}: HardwarePermissionStateProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  const handleOpenSettings = () => {
    tapMedium();
    if (onOpenSettings) {
      onOpenSettings();
    } else {
      Linking.openSettings().catch((err) => {
        console.warn('Failed to open settings:', err);
      });
    }
  };

  if (status === 'granted') {
    return null;
  }

  if (status === 'hardware_unavailable') {
    return (
      <View style={styles.container}>
        <View style={[styles.iconCircle, { backgroundColor: colors.secondaryText + '15', borderColor: colors.border }]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={38} color={colors.secondaryText} />
        </View>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Camera Unavailable
        </Text>
        <Text style={[styles.message, { color: colors.secondaryText }]}>
          Your device does not have a compatible camera hardware sensor available for {featureName}.
        </Text>
      </View>
    );
  }

  if (status === 'runtime_error') {
    return (
      <View style={styles.container}>
        <View style={[styles.iconCircle, { backgroundColor: colors.error + '15', borderColor: colors.error + '40' }]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={38} color={colors.error} />
        </View>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Camera Initialization Error
        </Text>
        <Text style={[styles.message, { color: colors.secondaryText }]}>
          {errorMessage || 'A problem occurred while communicating with your camera sensor.'}
        </Text>
        {onRetry && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.tint, opacity: isLoading ? 0.7 : 1 }]}
            onPress={() => {
              if (!isLoading) {
                tapMedium();
                onRetry();
              }
            }}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Retry camera"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Retry Camera</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (status === 'permanently_denied') {
    return (
      <View style={styles.container}>
        <View style={[styles.iconCircle, { backgroundColor: colors.error + '15', borderColor: colors.error + '40' }]}>
          <IconSymbol name="lock.fill" size={38} color={colors.error} />
        </View>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Camera Access Blocked
        </Text>
        <Text style={[styles.message, { color: colors.secondaryText }]}>
          Camera permission has been blocked for JezSy. Please enable camera access in your device Settings to use {featureName}.
        </Text>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.tint }]}
          onPress={handleOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Open device settings"
        >
          <View style={styles.btnContent}>
            <IconSymbol name="gear" size={18} color="#FFFFFF" />
            <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Open Settings</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // not_determined or denied_can_ask_again
  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: colors.tint + '15', borderColor: colors.tint + '40' }]}>
        <IconSymbol name="camera.fill" size={38} color={colors.tint} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Camera Access Required
      </Text>
      <Text style={[styles.message, { color: colors.secondaryText }]}>
        JezSy needs access to your camera to enable {featureName}.
      </Text>
      {onRequestPermission && (
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.tint, opacity: isLoading ? 0.7 : 1 }]}
          onPress={() => {
            if (!isLoading) {
              tapMedium();
              onRequestPermission();
            }
          }}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission"
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Grant Permission</Text>
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
  actionBtn: {
    height: 50,
    paddingHorizontal: Spacing.xxxl,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 180,
    ...Elevation.md,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
});
