import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { PrimaryButton } from '@/src/components/PrimaryButton';

export default function ResetPasswordScreen() {
  const { showToast } = useToast();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { endPasswordRecovery, signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
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

      // A password reset is often "I think I was compromised" -- revoke any
      // session on other devices, not just this one.
      await supabase.auth.signOut({ scope: 'others' });

      // Only now does the recovery session stop being a recovery session, so
      // routing may release the user into the app.
      endPasswordRecovery();

      Alert.alert('Password Updated', 'Your password has been reset.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (err: any) {
      showToast(err.message ?? 'Could not update your password.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Routing pins the user to this screen while a recovery session is active,
  // so there has to be a way out that does not grant access to the app.
  const handleCancel = async () => {
    await signOut();
    endPasswordRecovery();
    router.replace('/(auth)/welcome');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>Set a new password</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Choose a new password for your account.
          </Text>

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
            />
            <TouchableOpacity
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={12}
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
              onSubmitEditing={handleSubmit}
            />
          </View>

          <PrimaryButton
            label="Update Password"
            onPress={handleSubmit}
            loading={submitting}
          />

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel password reset and sign out"
          >
            <Text style={[styles.cancelButtonText, { color: colors.secondaryText }]}>
              Cancel and sign out
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  title: {
    // 26 has no slot; headline is 24/800, the same weight two points down.
    ...Type.headline,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: Spacing.xxxl,
    lineHeight: 21,
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
  cancelButton: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
