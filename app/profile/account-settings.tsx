import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
import type { UserIdentity } from '@supabase/supabase-js';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { passwordPolicyError } from '@/src/utils/passwordPolicy';
import { mapAuthErrorMessage } from '@/src/utils/authErrorMapping';
import {
  parseUserIdentities,
  PASSWORD_SAVED_MESSAGE,
  MANUAL_LINKING_POLICY_MESSAGE,
} from '@/src/utils/connectedAccounts';
import {
  getPendingDeletionRequest,
  getUserUnsettledBalance,
  submitDeletionRequest,
  withdrawDeletionRequest,
  UnsettledBalanceResult,
  DeletionRequestStatus,
} from '@/src/utils/accountDeletion';

// Official Google "G" logo
const GoogleLogo = () => (
  <Svg width={20} height={20} viewBox="0 0 48 48">
    <Defs>
      <ClipPath id="g">
        <Rect width={48} height={48} />
      </ClipPath>
    </Defs>
    <G clipPath="url(#g)">
      <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
      <Path d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z" fill="#FF3D00" />
      <Path d="M24 46c5.5 0 10.5-1.8 14.4-4.9l-6.7-5.5C29.7 37.3 27 38 24 38c-6.1 0-10.7-3.1-11.8-7.5l-7 5.4C8.1 42.1 15.5 46 24 46z" fill="#4CAF50" />
      <Path d="M44.5 20H24v8.5h11.8c-.9 2.9-3 5.3-5.8 6.9l6.7 5.5C41 37.7 45 31.4 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
    </G>
  </Svg>
);

export default function AccountSettingsScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();

  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [, setLoadingIdentities] = useState(true);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(null);
  const [pendingDeletionStatus, setPendingDeletionStatus] = useState<DeletionRequestStatus | null>(null);
  const [unsettledInfo, setUnsettledInfo] = useState<UnsettledBalanceResult | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');

  const fetchIdentities = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (!error && data?.identities) {
        setIdentities(data.identities);
      }
    } catch (err) {
      console.error('Failed to fetch user identities:', err);
    } finally {
      setLoadingIdentities(false);
    }
  }, []);

  useEffect(() => {
    fetchIdentities();
  }, [fetchIdentities]);

  const parsedIdentities = useMemo(
    () => parseUserIdentities(identities),
    [identities]
  );

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    getPendingDeletionRequest(user.id).then((req) => {
      if (!cancelled) {
        setPendingDeletionId(req?.id ?? null);
        setPendingDeletionStatus(req?.status ?? null);
      }
    });

    getUserUnsettledBalance(user.id).then((info) => {
      if (!cancelled) setUnsettledInfo(info);
    }).catch((err) => {
      console.error('Failed checking unsettled balance:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleSubmitDeletionRequest = async (reason?: string) => {
    if (!user?.id) return;
    setDeletionBusy(true);
    try {
      const id = await submitDeletionRequest(user.id, reason || deletionReason);
      setPendingDeletionId(id);
      setPendingDeletionStatus('pending');
      showToast('Deletion request submitted with 7-day grace period.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Could not submit your request.', 'error');
    } finally {
      setDeletionBusy(false);
    }
  };

  const handleRequestDeletion = () => {
    if (unsettledInfo?.hasUnsettledBalance) {
      Alert.alert(
        'Unsettled Balance Owed',
        `You have an unsettled balance of ₱${unsettledInfo.totalBalance.toFixed(
          2
        )} across ${unsettledInfo.unsettledCount} reservation(s). You must settle all remaining balances at the boutique before requesting account deletion.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'View Reservations', onPress: () => router.push('/reservations') },
        ]
      );
      return;
    }

    Alert.alert(
      'Request account deletion',
      'Your account will enter a 7-day grace period before permanent deletion. You can withdraw the request anytime before it is processed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm Deletion', style: 'destructive', onPress: () => handleSubmitDeletionRequest() },
      ],
    );
  };

  const handleWithdrawDeletion = async () => {
    if (!pendingDeletionId) return;
    setDeletionBusy(true);
    try {
      await withdrawDeletionRequest(pendingDeletionId);
      setPendingDeletionId(null);
      setPendingDeletionStatus(null);
      showToast('Deletion request withdrawn.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Could not withdraw your request.', 'error');
    } finally {
      setDeletionBusy(false);
    }
  };

  const handleSavePassword = async () => {
    const policyError = passwordPolicyError(password);
    if (policyError) {
      showToast(policyError, 'error');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setPassword('');
      setConfirmPassword('');
      showToast(PASSWORD_SAVED_MESSAGE, 'success');
      // Re-fetch authoritative identities after updating account
      fetchIdentities();
    } catch (err: any) {
      showToast(mapAuthErrorMessage(err, 'Could not update your password.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Account Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* ─── Connected Accounts Section (Informational / Read-Only) ─── */}
          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Connected Accounts</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
              Sign-in methods linked to your account
            </Text>

            {/* Google Identity */}
            <View style={[styles.accountCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.accountCardLeft}>
                <View style={[styles.providerIconContainer, { backgroundColor: colors.background }]}>
                  <GoogleLogo />
                </View>
                <View style={styles.providerInfo}>
                  <Text style={[styles.providerName, { color: colors.text }]}>Google</Text>
                  <Text style={[styles.providerEmail, { color: colors.secondaryText }]} numberOfLines={1}>
                    {parsedIdentities.hasGoogleIdentity
                      ? (parsedIdentities.googleEmail || user?.email || 'Connected')
                      : 'Not connected'}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  parsedIdentities.hasGoogleIdentity ? styles.statusBadgeConnected : styles.statusBadgeDisconnected,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: parsedIdentities.hasGoogleIdentity ? '#059669' : colors.secondaryText },
                  ]}
                >
                  {parsedIdentities.hasGoogleIdentity ? '✓ Connected' : 'Not Connected'}
                </Text>
              </View>
            </View>

            {/* Email Identity */}
            <View style={[styles.accountCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.accountCardLeft}>
                <View style={[styles.providerIconContainer, { backgroundColor: colors.background }]}>
                  <IconSymbol name="envelope.fill" size={18} color={colors.secondaryText} />
                </View>
                <View style={styles.providerInfo}>
                  <Text style={[styles.providerName, { color: colors.text }]}>Email</Text>
                  <Text style={[styles.providerEmail, { color: colors.secondaryText }]} numberOfLines={1}>
                    {parsedIdentities.hasEmailIdentity
                      ? (parsedIdentities.emailAddress || user?.email || 'Connected')
                      : (user?.email || 'Not connected')}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  parsedIdentities.hasEmailIdentity ? styles.statusBadgeConnected : styles.statusBadgeDisconnected,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: parsedIdentities.hasEmailIdentity ? '#059669' : colors.secondaryText },
                  ]}
                >
                  {parsedIdentities.hasEmailIdentity ? '✓ Connected' : 'Not Connected'}
                </Text>
              </View>
            </View>

            {/* Informational Policy Notice */}
            <Text style={[styles.policyNotice, { color: colors.secondaryText }]}>
              {MANUAL_LINKING_POLICY_MESSAGE}
            </Text>
          </View>

          {/* ─── Password Section (Neutral Wording: Set or Update) ─── */}
          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Password</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
              Set or update your password
            </Text>

            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <IconSymbol name="lock.fill" size={18} color={colors.secondaryText} />
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text }]}
                placeholder="New password"
                placeholderTextColor={colors.secondaryText}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                accessibilityLabel="New password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <IconSymbol
                  name={showPassword ? 'eye.fill' : 'eye.slash.fill'}
                  size={18}
                  color={colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <IconSymbol name="lock.fill" size={18} color={colors.secondaryText} />
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.secondaryText}
                secureTextEntry={!showPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSavePassword}
                accessibilityLabel="Confirm new password"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.tint, opacity: submitting ? 0.6 : 1 }]}
              onPress={handleSavePassword}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Save password"
              accessibilityState={{ disabled: submitting }}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.submitButtonText, { color: colors.onTint }]}>Save Password</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ─── Delete Account Section ─── */}
          <View style={[styles.section, { borderColor: colors.border, borderBottomWidth: 0 }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Delete Account</Text>

            {pendingDeletionId && pendingDeletionStatus === 'auth_revocation_pending' ? (
              <View style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <IconSymbol name="lock.fill" size={18} color={colors.tint} />
                <Text style={[styles.noticeText, { color: colors.secondaryText }]}>
                  Your data has been erased and account access is being finalized. No further action is needed; please contact support if you can still sign in after a few minutes.
                </Text>
              </View>
            ) : pendingDeletionId ? (
              <>
                <View style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <IconSymbol name="clock.arrow.circlepath" size={18} color={colors.tint} />
                  <Text style={[styles.noticeText, { color: colors.secondaryText }]}>
                    Your account is scheduled for deletion after a 7-day grace period. You can withdraw this request anytime before then.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border, opacity: deletionBusy ? 0.6 : 1 }]}
                  onPress={handleWithdrawDeletion}
                  disabled={deletionBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Withdraw account deletion request"
                  accessibilityState={{ disabled: deletionBusy }}
                >
                  {deletionBusy ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                      Withdraw Deletion Request
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : unsettledInfo?.hasUnsettledBalance ? (
              <>
                <View style={[styles.noticeBox, { borderColor: colors.warning, backgroundColor: colors.warning + '1A' }]}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={18} color={colors.warning} />
                  <Text style={[styles.noticeText, { color: colors.text, fontWeight: '500' }]}>
                    You have an outstanding balance of ₱{unsettledInfo.totalBalance.toFixed(2)} across {unsettledInfo.unsettledCount} reservation(s). You must settle all remaining balances before requesting account deletion.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.tint, marginTop: Spacing.sm }]}
                  onPress={() => router.push('/reservations')}
                  accessibilityRole="button"
                  accessibilityLabel="View reservations to settle balance"
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.tint, fontWeight: '600' }]}>
                    View My Reservations
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.noticeText, { color: colors.secondaryText, marginBottom: Spacing.sm }]}>
                  Please select a reason for requesting account deletion:
                </Text>
                
                {['No longer using the app', 'Privacy concerns', 'Found an alternative', 'Other'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: deletionReason === r ? colors.tint : colors.border,
                      backgroundColor: deletionReason === r ? colors.card : 'transparent',
                      marginBottom: 8,
                    }}
                    onPress={() => setDeletionReason(r)}
                  >
                    <Text style={{ fontSize: 13, color: deletionReason === r ? colors.tint : colors.text, fontWeight: deletionReason === r ? '600' : '400' }}>
                      {deletionReason === r ? ' ' : ''}{r}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[styles.dangerButton, { borderColor: colors.error, opacity: deletionBusy ? 0.6 : 1, marginTop: Spacing.sm }]}
                  onPress={handleRequestDeletion}
                  disabled={deletionBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Request account deletion"
                  accessibilityState={{ disabled: deletionBusy }}
                >
                  {deletionBusy ? (
                    <ActivityIndicator color={colors.error} />
                  ) : (
                    <Text style={[styles.dangerButtonText, { color: colors.error }]}>
                      Request Account Deletion (7-Day Grace Period)
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  content: { padding: Spacing.xl },
  section: {
    paddingBottom: Spacing.xxl,
    marginBottom: Spacing.xxl,
    borderBottomWidth: 1,
  },
  sectionTitle: { ...Type.bodyLargeStrong, marginBottom: 4 },
  sectionSubtitle: {
    fontSize: 13,
    marginBottom: Spacing.lg,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 12,
  },
  accountCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  providerIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  providerEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeConnected: {
    backgroundColor: 'rgba(5, 150, 105, 0.12)',
  },
  statusBadgeDisconnected: {
    backgroundColor: 'rgba(150, 150, 150, 0.12)',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  policyNotice: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: Spacing.lg,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  submitButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonText: {
    ...Type.bodyLargeStrong,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: Spacing.lg,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  dangerButton: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
