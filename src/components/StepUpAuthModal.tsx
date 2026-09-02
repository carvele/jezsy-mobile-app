import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';

interface StepUpAuthModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  /** Called once the 6-digit code has been verified -- the session is now fresh. */
  onVerified: () => void;
}

const RESEND_SECONDS = 60;

/**
 * Step-up re-authentication for a single sensitive action (currently:
 * submitting a reservation), not a blanket app-wide gate -- OWASP ASVS
 * step-up guidance ties re-auth strength to the sensitivity of the specific
 * action, not a calendar timer independent of what's being done. Reuses the
 * same signInWithOtp/verifyOtp calls already proven in app/(auth)/auth.tsx,
 * just packaged as a modal so it can run over any screen without hitting the
 * (auth) route group's "already signed in -> redirect to tabs" guard in
 * app/_layout.tsx.
 */
export function StepUpAuthModal({ visible, email, onClose, onVerified }: StepUpAuthModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();

  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [timer, setTimer] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const isCounting = timer > 0;
  useEffect(() => {
    if (!isCounting) return;
    const interval = setInterval(() => {
      setTimer(t => (t <= 1 ? 0 : t - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isCounting]);

  const sendCode = async () => {
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      setTimer(RESEND_SECONDS);
      setTimeout(() => inputRef.current?.focus(), 250);
    } catch (err: any) {
      showToast(err.message ?? 'Could not send verification code.', 'error');
    } finally {
      setSending(false);
    }
  };

  // Fire once per time the modal opens, not on every re-render.
  useEffect(() => {
    if (visible) {
      setCode('');
      sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const verifyCode = async (codeToVerify?: string) => {
    const value = codeToVerify ?? code;
    if (value.length < 6) {
      showToast('Enter the 6-digit code sent to your email.', 'error');
      return;
    }
    setVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: value.trim(),
        type: 'email',
      });
      if (error) throw error;
      onVerified();
    } catch (err: any) {
      showToast(err.message ?? 'That code is invalid or has expired.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleCodeChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').substring(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) verifyCode(cleaned);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Confirm It&apos;s You</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Cancel">
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
              It&apos;s been a while since you last signed in. For your security, enter the 6-digit
              code we sent to {email} to complete this reservation.
            </Text>

            <TextInput keyboardAppearance={theme}
              ref={inputRef}
              style={[styles.codeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="000000"
              placeholderTextColor={colors.secondaryText}
              value={code}
              onChangeText={handleCodeChange}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.verifyBtn, { backgroundColor: colors.tint, opacity: verifying ? 0.7 : 1 }]}
              onPress={() => verifyCode()}
              disabled={verifying || sending}
              accessibilityRole="button"
              accessibilityLabel="Verify code"
            >
              {verifying ? <ActivityIndicator color={colors.onTint} /> : (
                <Text style={[styles.verifyBtnText, { color: colors.onTint }]}>Verify & Continue</Text>
              )}
            </TouchableOpacity>

            <View style={styles.resendRow}>
              {sending ? (
                <Text style={[styles.timerText, { color: colors.secondaryText }]}>Sending code...</Text>
              ) : timer > 0 ? (
                <Text style={[styles.timerText, { color: colors.secondaryText }]}>Resend code in {timer}s</Text>
              ) : (
                <TouchableOpacity onPress={sendCode} hitSlop={10}>
                  <Text style={[styles.resendText, { color: colors.tint }]}>Resend Code</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerTitle: {
    ...Type.subtitle,
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: Spacing.sm,
  },
  body: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  codeInput: {
    height: 56,
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
  },
  verifyBtn: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
  resendRow: {
    alignItems: 'center',
  },
  timerText: {
    fontSize: 13,
    fontWeight: '500',
  },
  resendText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
