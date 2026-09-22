import React from 'react';
import { StyleSheet, Text, View, StatusBar, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Sparkles } from 'lucide-react-native';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/src/context/AuthContext';

import { isProfileSetupComplete } from '@/src/utils/profileCompletion';
import { consumeAuthReturnTarget, consumePendingEntryTarget } from '@/src/utils/authReturnTarget';

export default function AccountCreatedScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  const isComplete = isProfileSetupComplete(profile);

  const handlePrimaryAction = async () => {
    await refreshProfile().catch(() => {});
    if (!isProfileSetupComplete(profile)) {
      router.replace('/(auth)/profile-setup' as any);
      return;
    }

    const returnTarget = await consumeAuthReturnTarget();
    if (returnTarget) {
      router.replace({
        pathname: returnTarget.pathname,
        params: returnTarget.params,
      } as any);
      return;
    }

    const pendingEntry = await consumePendingEntryTarget();
    if (pendingEntry) {
      router.replace({
        pathname: pendingEntry.pathname,
        params: pendingEntry.params,
      } as any);
      return;
    }

    router.replace('/(tabs)' as any);
  };

  const handleReviewProfile = () => {
    router.replace('/(auth)/profile-setup' as any);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Ambient gradient */}
      <LinearGradient
        colors={['rgba(212, 175, 55, 0.12)', 'rgba(10, 10, 10, 0.98)']}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.card}>
        {/* Luxury Gold Celebration Seal */}
        <View style={styles.sealContainer}>
          <LinearGradient
            colors={['#D4AF37', '#997F29']}
            style={styles.sealGradient}
          >
            <View style={styles.sealInner}>
              <Check size={32} color="#1F1C18" strokeWidth={3} />
            </View>
          </LinearGradient>
          <View style={styles.sparkleBadge}>
            <Sparkles size={14} color="#D4AF37" />
          </View>
        </View>

        <Text style={styles.brandSubtitle}>JEZSY ATELIER</Text>
        <Text style={styles.title}>Welcome to JezSy</Text>

        <Text style={styles.message}>
          Your account is fully verified. Complete your style profile to reserve private fitting rooms and experience digital couture tailored to your measurements.
        </Text>

        <View style={styles.actions}>
          <PrimaryButton
            label={isComplete ? 'Start Exploring' : 'Complete Profile'}
            onPress={handlePrimaryAction}
            dark
            style={styles.primaryBtn}
          />

          {isComplete && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleReviewProfile}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Review Style Profile"
            >
              <Text style={styles.secondaryButtonText}>Review Style Profile</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    padding: Spacing.xl,
    alignItems: 'center',
  },
  sealContainer: {
    position: 'relative',
    marginBottom: Spacing.lg,
  },
  sealGradient: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  sealInner: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
    backgroundColor: '#FAF7EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#1F1C18',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  brandSubtitle: {
    color: Colors.dark.tint,
    fontSize: 12,
    letterSpacing: 2.5,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  message: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  actions: {
    width: '100%',
    gap: Spacing.md,
  },
  primaryBtn: {
    width: '100%',
  },
  secondaryButton: {
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
