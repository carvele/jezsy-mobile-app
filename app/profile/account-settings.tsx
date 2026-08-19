import React, { useEffect, useState } from 'react';
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
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { passwordPolicyError, translatePasswordServerError } from '@/src/utils/passwordPolicy';
import {
  getPendingDeletionRequest,
  getUserUnsettledBalance,
  submitDeletionRequest,
  withdrawDeletionRequest,
  UnsettledBalanceResult,
  DeletionRequestStatus,
} from '@/src/utils/accountDeletion';

export default function AccountSettingsScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(null);
  const [pendingDeletionStatus, setPendingDeletionStatus] = useState<DeletionRequestStatus | null>(null);
  const [unsettledInfo, setUnsettledInfo] = useState<UnsettledBalanceResult | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);

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

  const [deletionReason, setDeletionReason] = useState('');

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

  const handleChangePassword = async () => {
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
      showToast('Your password has been changed.', 'success');
    } catch (err: any) {
      showToast(translatePasswordServerError(err.message ?? 'Could not update your password.'), 'error');
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
          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Email</Text>
            <Text style={[styles.readOnlyValue, { color: colors.secondaryText, borderColor: colors.border, backgroundColor: colors.card }]}>
              {user?.email || 'Not available'}
            </Text>
          </View>

          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Change Password</Text>

            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <IconSymbol name="lock.fill" size={18} color={colors.secondaryText} />
              <TextInput keyboardAppearance={theme}
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
              <TextInput keyboardAppearance={theme}
                style={[styles.input, { color: colors.text }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.secondaryText}
                secureTextEntry={!showPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleChangePassword}
                accessibilityLabel="Confirm new password"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.tint, opacity: submitting ? 0.6 : 1 }]}
              onPress={handleChangePassword}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Update password"
              accessibilityState={{ disabled: submitting }}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.submitButtonText, { color: colors.onTint }]}>Update Password</Text>
              )}
            </TouchableOpacity>
          </View>

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
                <View style={[styles.noticeBox, { borderColor: '#EAB308', backgroundColor: 'rgba(234,179,8,0.08)' }]}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={18} color="#EAB308" />
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
                      {deletionReason === r ? '✓ ' : ''}{r}
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
  sectionTitle: { ...Type.bodyLargeStrong, marginBottom: Spacing.lg },
  readOnlyValue: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    fontSize: 15,
    textAlignVertical: 'center',
    lineHeight: 52,
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
