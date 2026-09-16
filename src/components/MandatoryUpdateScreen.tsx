import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
} from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RemoteVersionPolicy } from '@/src/services/appVersionService';

interface MandatoryUpdateScreenProps {
  policy: RemoteVersionPolicy | null;
  clientVersion: string;
  onRetry: () => Promise<void>;
}

export function MandatoryUpdateScreen({
  policy,
  clientVersion,
  onRetry,
}: MandatoryUpdateScreenProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const [retrying, setRetrying] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpenStore = async () => {
    setOpenError(null);
    if (!policy) return;

    try {
      if (policy.store_url) {
        const supported = await Linking.canOpenURL(policy.store_url);
        if (supported) {
          await Linking.openURL(policy.store_url);
          return;
        }
      }
    } catch {
      // Intent/protocol failed, proceed to fallback
    }

    // Fallback to standard HTTPS store link
    try {
      if (policy.store_fallback_url) {
        await Linking.openURL(policy.store_fallback_url);
        return;
      }
    } catch {
      setOpenError('Could not open store link. Please search for "JezSy" directly in your app store.');
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setOpenError(null);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleGetSupport = () => {
    const email = 'support@jezsy.com';
    const subject = encodeURIComponent('App Update Assistance');
    const body = encodeURIComponent(
      `Hello JezSy Team,\n\nI am experiencing an issue updating the app from version ${clientVersion}.\nPlatform: ${Platform.OS}`
    );
    Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`).catch(() => {});
  };

  const storeName = Platform.select({
    ios: 'App Store',
    android: 'Google Play',
    default: 'App Store',
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Luxury Brand Icon Badge */}
        <View style={[styles.iconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="arrow.clockwise" size={40} color={colors.tint} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {policy?.title || 'Update Required'}
        </Text>

        <Text style={[styles.message, { color: colors.secondaryText }]}>
          {policy?.message ||
            'A new version of JezSy is required to continue. Please update to access our latest collections.'}
        </Text>

        <View style={[styles.versionBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.versionText, { color: colors.secondaryText }]}>
            Current: <Text style={{ color: colors.text, fontWeight: '600' }}>v{clientVersion}</Text>
            {policy?.min_version ? (
              <>
                {'  •  '}Required:{' '}
                <Text style={{ color: colors.tint, fontWeight: '700' }}>
                  v{policy.min_version}
                </Text>
              </>
            ) : null}
          </Text>
        </View>

        {openError ? (
          <Text style={[styles.errorText, { color: colors.error }]}>{openError}</Text>
        ) : null}

        {/* Primary Action */}
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleOpenStore}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Update on ${storeName}`}
        >
          <IconSymbol name="arrow.down" size={18} color={colors.onTint} style={{ marginRight: 8 }} />
          <Text style={[styles.primaryButtonText, { color: colors.onTint }]}>
            Update on {storeName}
          </Text>
        </TouchableOpacity>

        {/* Secondary Retry Action */}
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleRetry}
          disabled={retrying}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry version check"
        >
          {retrying ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <>
              <IconSymbol name="arrow.clockwise" size={16} color={colors.tint} style={{ marginRight: 6 }} />
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                Check Again
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Tertiary Support Action */}
        <TouchableOpacity
          style={styles.supportButton}
          onPress={handleGetSupport}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Contact customer support"
        >
          <Text style={[styles.supportButtonText, { color: colors.secondaryText }]}>
            Need help? Contact Customer Support
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    ...Type.title,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  message: {
    ...Type.body,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  versionBox: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  versionText: {
    ...Type.caption,
  },
  errorText: {
    ...Type.caption,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 50,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  primaryButtonText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  secondaryButtonText: {
    ...Type.bodyStrong,
  },
  supportButton: {
    padding: Spacing.sm,
  },
  supportButtonText: {
    ...Type.caption,
    textDecorationLine: 'underline',
  },
});
