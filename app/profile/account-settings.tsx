import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';

export default function AccountSettingsScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleChangePassword = async () => {
    if (password.length < 8) {
      Alert.alert('Password Too Short', 'Please use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords Don’t Match', 'Please re-enter matching passwords.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setPassword('');
      setConfirmPassword('');
      Alert.alert('Password Updated', 'Your password has been changed.');
    } catch (err: any) {
      Alert.alert('Update Failed', err.message ?? 'Could not update your password.');
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

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Email</Text>
            <Text style={[styles.readOnlyValue, { color: colors.secondaryText, borderColor: colors.border, backgroundColor: colors.card }]}>
              {user?.email || 'Not available'}
            </Text>
          </View>

          <View style={[styles.section, { borderColor: colors.border, borderBottomWidth: 0 }]}>
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
                <ActivityIndicator color="#0D0D0D" />
              ) : (
                <Text style={styles.submitButtonText}>Update Password</Text>
              )}
            </TouchableOpacity>
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
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
});
