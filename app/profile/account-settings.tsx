import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';

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
  const [deletionBusy, setDeletionBusy] = useState(false);

  // Cast: account_deletion_requests is added by migration 20260729101500 and
  // is not in the generated types until that is applied and they are
  // regenerated.
  const deletionTable = useCallback(
    () => (supabase as any).from('account_deletion_requests'),
    [],
  );

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      const { data } = await deletionTable()
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .maybeSingle();
      if (!cancelled) setPendingDeletionId(data?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, deletionTable]);

  const submitDeletionRequest = async () => {
    if (!user?.id) return;
    setDeletionBusy(true);
    try {
      const { data, error } = await deletionTable()
        .insert({ user_id: user.id })
        .select('id')
        .single();
      if (error) throw error;

      setPendingDeletionId(data.id);
      showToast('Deletion request submitted. Our team will be in touch.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Could not submit your request.', 'error');
    } finally {
      setDeletionBusy(false);
    }
  };

  // Kept as an Alert rather than a toast: this needs a confirm/cancel choice,
  // matching the other destructive confirmations in the app.
  const handleRequestDeletion = () => {
    Alert.alert(
      'Request account deletion',
      'Your account will not be deleted right away. We review each request by hand, and any active reservations must be settled first. You can withdraw the request at any time before it is processed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request deletion', style: 'destructive', onPress: submitDeletionRequest },
      ],
    );
  };

  const handleWithdrawDeletion = async () => {
    if (!pendingDeletionId) return;
    setDeletionBusy(true);
    try {
      const { error } = await deletionTable().delete().eq('id', pendingDeletionId);
      if (error) throw error;

      setPendingDeletionId(null);
      showToast('Deletion request withdrawn.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Could not withdraw your request.', 'error');
    } finally {
      setDeletionBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (password.length < 8) {
      showToast('Please use at least 8 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Please re-enter matching passwords.', 'error');
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
      showToast(err.message ?? 'Could not update your password.', 'error');
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

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
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
              <TextInput
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

            {pendingDeletionId ? (
              <>
                <View style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <IconSymbol name="clock.arrow.circlepath" size={18} color={colors.tint} />
                  <Text style={[styles.noticeText, { color: colors.secondaryText }]}>
                    Your deletion request is with our team. We will email you once it has
                    been processed.
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
                      Withdraw Request
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.noticeText, { color: colors.secondaryText, marginBottom: 16 }]}>
                  Deletion is handled by hand so we can settle any active reservations
                  first. Requesting it does not sign you out or remove anything straight
                  away.
                </Text>
                <TouchableOpacity
                  style={[styles.dangerButton, { borderColor: colors.error, opacity: deletionBusy ? 0.6 : 1 }]}
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
                      Request Account Deletion
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20 },
  section: {
    paddingBottom: 24,
    marginBottom: 24,
    borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 16 },
  readOnlyValue: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    textAlignVertical: 'center',
    lineHeight: 52,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
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
    fontSize: 16,
    fontWeight: '700',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
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
