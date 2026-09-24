import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  LayoutAnimation,
  UIManager,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { ArrowLeft, Eye, EyeOff, Mail, Lock, Check, Circle, Edit3 } from 'lucide-react-native';
import { useToast } from '@/src/context/ToastContext';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { LegalReaderModal } from '@/src/components/LegalReaderModal';
import {
  passwordPolicyError,
  evaluatePasswordRequirements,
  areAllPasswordRequirementsMet,
  PasswordRequirementCheck,
} from '@/src/utils/passwordPolicy';

import { mapAuthErrorMessage } from '@/src/utils/authErrorMapping';
import { isDuplicateSignup, DUPLICATE_ACCOUNT_MESSAGE } from '@/src/utils/connectedAccounts';
import { legalService } from '@/src/services/legalService';
import { normalizeMobileNumber } from '@/src/utils/profileFields';
// Enable LayoutAnimation on Android (Legacy Architecture only)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental && !(globalThis as any).nativeFabricUIManager) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Curated editorial fashion image for the glassmorphism background
const BG_IMAGE =
  'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=85&w=1200&auto=format&fit=crop';

type Mode = 'login' | 'signup' | 'otp_request' | 'otp_verify' | 'forgot';
type VerificationType = 'signup' | 'login';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: 'login' | 'signup' }>();

  const [mode, setMode] = useState<Mode>(params.mode === 'signup' ? 'signup' : 'login');
  const [verificationType, setVerificationType] = useState<VerificationType>('login');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [timer, setTimer] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [hasReadTerms, setHasReadTerms] = useState(false);
  const [activeLegalModal, setActiveLegalModal] = useState<'terms' | 'privacy' | null>(null);

  // Chained input refs for seamless keyboard navigation
  const emailRef = useRef<TextInput>(null);
  const loginIdentifierRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const otpInputRef = useRef<TextInput>(null);

  const transitionMode = useCallback((nextMode: Mode) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setOtpCode('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, []);

  // Sync mode with route parameter if it changes
  useEffect(() => {
    if (params.mode === 'signup' || params.mode === 'login') {
      if (params.mode !== mode && (mode === 'login' || mode === 'signup')) {
        transitionMode(params.mode);
      }
    }
  }, [params.mode, mode, transitionMode]);

  // Timer countdown handler for OTP resend.
  const isCounting = timer > 0;
  useEffect(() => {
    if (!isCounting) return;
    const interval = setInterval(() => {
      setTimer(t => {
        if (t <= 1) {
          clearInterval(interval);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isCounting]);

  // Focus the hidden OTP input when transitioning to 'otp_verify' step
  useEffect(() => {
    if (mode === 'otp_verify') {
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 250);
    }
  }, [mode]);


  const validateEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

  // ─── Sign Up (Email + Password) ──────────────────────
  const handleSignUp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      showToast('Enter a valid email address.', 'error');
      return;
    }
    const policyError = passwordPolicyError(password);
    if (policyError) {
      showToast(policyError, 'error');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    if (!hasReadTerms) {
      showToast('Please read the Terms of Service before agreeing.', 'error');
      setActiveLegalModal('terms');
      return;
    }
    if (!legalAccepted) {
      showToast('Please agree to the Terms & Conditions and Privacy Policy to create an account.', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) throw error;

      // If user is already logged in (confirm email was turned off)
      if (data?.session) {
        await legalService.recordSignupLegalAcceptance();
        router.replace('/(auth)/account-created' as any);
        return;
      }

      // Supabase does not error on a duplicate address: it returns an
      // obfuscated user with an empty identities array and sends no email,
      // deliberately, so the response cannot be used to enumerate accounts.
      // That empty array is the only reliable duplicate signal. No account is
      // created either way, so the requirement is already satisfied by the
      // server -- we detect it only to avoid arming a resend timer for a code
      // that was never sent, and we take the identical UI path so this branch
      // stays indistinguishable from a real signup.
      if (isDuplicateSignup(data)) {
        showToast(DUPLICATE_ACCOUNT_MESSAGE, 'info');
        transitionMode('login');
        return;
      }

      setVerificationType('signup');
      setTimer(60);
      transitionMode('otp_verify');
    } catch (err: any) {
      console.error('Sign Up error:', err);
      if (isDuplicateSignup(null, err)) {
        showToast(DUPLICATE_ACCOUNT_MESSAGE, 'info');
        transitionMode('login');
        return;
      }
      showToast(mapAuthErrorMessage(err, 'Could not create your account. Please check your details and try again.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── Log In (Email + Password) ───────────────────────
  const handlePasswordLogin = async () => {
    const identifier = loginIdentifier.trim();
    const trimmedEmail = identifier.toLowerCase();
    const normalizedPhone = normalizeMobileNumber(identifier);

    if (!validateEmail(trimmedEmail) && !normalizedPhone) {
      showToast('Enter a valid email address or mobile number.', 'error');
      return;
    }
    if (!password) {
      showToast('Please enter your password.', 'info');
      return;
    }

    setLoading(true);
    try {
      // No pre-flight existence check: signInWithPassword already rejects both
      // an unknown address and a wrong password, so the check enforced nothing
      // and only disclosed which addresses are registered.
      const { error } = await supabase.auth.signInWithPassword(
        validateEmail(trimmedEmail) ? { email: trimmedEmail, password } : { phone: normalizedPhone!, password }
      );

      if (error) throw error;

      showToast('Welcome back!', 'success');
      // Auth state listener handles routing
    } catch (err: any) {
      console.error('Login error:', err);
      const msg = err?.message ?? '';
      if (validateEmail(trimmedEmail) && msg.toLowerCase().includes('email not confirmed')) {
        // signInWithPassword failing never dispatches a code, so send one
        // explicitly before arming the resend timer
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup',
          email: trimmedEmail,
        });
        if (resendError) {
          showToast(mapAuthErrorMessage(resendError, 'Could not send verification code.'), 'error');
          return;
        }
        setVerificationType('signup');
        setTimer(60);
        transitionMode('otp_verify');
        return;
      }
      showToast(mapAuthErrorMessage(err, 'Incorrect email, mobile number, or password. Please try again.'), 'error');
    } finally {
      setLoading(false);
    }
  };


  // ─── Request Passwordless OTP Code ───────────────────
  const handleRequestOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    setLoading(true);
    try {
      // signInWithOtp does not disclose whether the address exists; a
      // pre-flight existence check would have undone that.
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
      });

      if (error) throw error;

      setVerificationType('login');
      setTimer(60);
      transitionMode('otp_verify');
    } catch (err: any) {
      console.error('Send OTP error:', err);
      showToast(mapAuthErrorMessage(err, 'Could not send verification code. Please try again.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── Verify OTP Code (Handles Sign Up & Log In) ──────
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify ?? otpCode;
    if (code.length < 6) {
      showToast('Please enter the 6-digit code sent to your email.', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: verificationType === 'signup' ? 'signup' : 'email',
      });

      if (error) throw error;

      if (verificationType === 'signup' && data.session) {
        try {
          await legalService.recordSignupLegalAcceptance();
        } catch (legalError) {
          console.error('Sign-up legal acceptance error:', legalError);
          showToast('Your account is verified. Please complete legal acceptance before continuing.', 'info');
        }
        router.replace('/(auth)/account-created' as any);
        return;
      }

      // AuthState change listener in root layout will automatically handle routing
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      showToast(mapAuthErrorMessage(err, 'The code entered is invalid or has expired.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── Resend Code ─────────────────────────────────────
  const handleResendCode = async () => {
    if (timer > 0) return;
    setLoading(true);
    try {
      // Both branches previously gated on an existence check that disclosed
      // whether the address was registered. Supabase's own responses here are
      // deliberately non-disclosing, so let them through unchanged.
      if (verificationType === 'signup') {
        // resend() needs no password -- signUp() would reject the empty
        // string transitionMode leaves behind after every screen change
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: email.trim().toLowerCase(),
        });
        if (error) throw error;
      } else {
        // Resend passwordless login OTP
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
        });
        if (error) throw error;
      }

      setTimer(60);
      setOtpCode('');
      showToast('A new 6-digit verification code has been sent to your email.', 'success');
    } catch (err: any) {
      console.error('Resend OTP error:', err);
      showToast(mapAuthErrorMessage(err, 'Could not resend verification code. Please try again later.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── Forgot Password ────────────────────────────────
  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    setLoading(true);
    try {
      // The existence check here contradicted the deliberately generic
      // "If an account exists..." message shown on success below.
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: Linking.createURL('reset-password'),
      });

      if (error) throw error;

      Alert.alert(
        'Check Your Email',
        'If an account exists with that email, we\'ve sent a password reset link.',
        [{ text: 'OK', onPress: () => transitionMode('login') }]
      );
    } catch (err: any) {
      console.error('Reset password error:', err);
      showToast(mapAuthErrorMessage(err, 'Could not send reset email. Please try again.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── Dynamic UI Texts ───────────────────────────────
  const getTitle = () => {
    switch (mode) {
      case 'login':       return 'Welcome.';
      case 'signup':      return 'Create\naccount.';
      case 'otp_request': return 'Log in\nwith code.';
      case 'otp_verify':  return 'Enter the\ncode.';
      case 'forgot':      return 'Reset\npassword.';
    }
  };

  const getSubtitle = () => {
    switch (mode) {
      case 'login':       return 'Sign in with your email & password.';
      case 'signup':      return 'Join Jezsy and explore your personal style.';
      case 'otp_request': return 'Enter your email to receive a 6-digit login code.';
      case 'otp_verify':  return `We sent a 6-digit verification code to ${email}`;
      case 'forgot':      return 'Enter your email and we\'ll send a reset link.';
    }
  };


  const goBack = () => {
    if (mode === 'login') {
      router.back();
    } else if (mode === 'otp_verify') {
      transitionMode(verificationType === 'signup' ? 'signup' : 'otp_request');
    } else {
      if (mode === 'signup') setLegalAccepted(false);
      transitionMode('login');
    }
  };

  const handleSubmit = () => {
    switch (mode) {
      case 'login':       return handlePasswordLogin();
      case 'signup':      return handleSignUp();
      case 'otp_request': return handleRequestOtp();
      case 'otp_verify':  return handleVerifyOtp();
      case 'forgot':      return handleForgotPassword();
    }
  };

  const getButtonText = () => {
    switch (mode) {
      case 'login':       return 'Sign In';
      case 'signup':      return 'Continue to Verification';
      case 'otp_request': return 'Send Verification Code';
      case 'otp_verify':  return 'Verify & Login';
      case 'forgot':      return 'Send Reset Link';
    }
  };

  // Account creation is 'signup' -> 'otp_verify' (2 steps); 'otp_verify' is
  // also reachable from the log-in-with-code flow (verificationType
  // 'login'), which isn't account creation, so the indicator only shows
  // for the genuine signup path. Mirrors the pill + "N/Total" pattern
  // already used on profile-setup.tsx, the next screen in this same flow.
  const SIGNUP_TOTAL_STEPS = 2;
  const signupStepIndex =
    mode === 'signup' ? 0 : mode === 'otp_verify' && verificationType === 'signup' ? 1 : null;

  const handleOtpTextChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').substring(0, 6);
    setOtpCode(cleaned);
    if (cleaned.length === 6) {
      handleVerifyOtp(cleaned);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Background */}
      <Image source={BG_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.75)', 'rgba(10,10,10,0.98)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Back button */}
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + 12 }]}
          onPress={goBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous authentication screen"
        >
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 64 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Account-creation step indicator: only for the signup -> otp_verify
              path, not login-with-code (which also passes through otp_verify) */}
          {signupStepIndex !== null && (
            <View style={styles.signupStepRow} accessibilityLabel={`Step ${signupStepIndex + 1} of ${SIGNUP_TOTAL_STEPS}`}>
              <View style={styles.signupStepPills}>
                {Array.from({ length: SIGNUP_TOTAL_STEPS }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.signupStepPill,
                      i === signupStepIndex
                        ? styles.signupStepPillActive
                        : i < signupStepIndex
                        ? styles.signupStepPillDone
                        : styles.signupStepPillUpcoming,
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.signupStepCount}>
                Step {signupStepIndex + 1} of {SIGNUP_TOTAL_STEPS}
              </Text>
            </View>
          )}

          {/* Dynamic heading */}
          <View style={styles.headingWrapper}>
            <Text style={styles.title}>{getTitle()}</Text>
            <Text style={styles.subtitle}>{getSubtitle()}</Text>
          </View>

          {/* Glassmorphism card */}
          <View style={styles.glassCard}>

            {/* ─── Sign Up Form (Canonical Keyboard Chaining) ─── */}
            {mode === 'signup' && (
              <>
                {/* 1. Email Address */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Email address</Text>
                  <View style={styles.inputRow}>
                    <Mail size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                    <TextInput
                      ref={emailRef}
                      keyboardAppearance="dark"
                      style={styles.input}
                      placeholder="Enter your email"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      autoFocus
                      keyboardType="email-address"
                      autoComplete="email"
                      textContentType="emailAddress"
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                      accessibilityLabel="Email address"
                    />
                  </View>
                </View>

                {/* 5. Password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.inputRow}>
                    <Lock size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                    <TextInput
                      ref={passwordRef}
                      keyboardAppearance="dark"
                      style={styles.inputWithAction}
                      placeholder="Create password"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="new-password"
                      textContentType="newPassword"
                      returnKeyType="next"
                      onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                      accessibilityLabel="Password"
                      accessibilityHint="Create a secure password matching all policy requirements"
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      accessibilityState={{ expanded: showPassword }}
                    >
                      {showPassword ? (
                        <EyeOff size={20} color="rgba(255,255,255,0.6)" />
                      ) : (
                        <Eye size={20} color="rgba(255,255,255,0.6)" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Progressive Password Requirements */}
                {password.length > 0 && (
                  areAllPasswordRequirementsMet(password) ? (
                    <View style={styles.matchRow} accessibilityRole="summary" accessibilityLabel="Password meets all requirements">
                      <Check size={13} color={Colors.dark.tint} />
                      <Text style={[styles.matchText, { color: Colors.dark.tint }]}>Password meets all requirements</Text>
                    </View>
                  ) : (
                    <View
                      style={styles.pillsContainer}
                      accessibilityRole="summary"
                      accessibilityLabel="Password requirements"
                    >
                      {evaluatePasswordRequirements(password).map((req: PasswordRequirementCheck) => (
                        <View
                          key={req.id}
                          style={[
                            styles.pillBadge,
                            req.met ? styles.pillBadgeMet : styles.pillBadgeUnmet,
                          ]}
                          accessibilityLabel={`${req.label}: ${req.met ? 'satisfied' : 'not met'}`}
                        >
                          {req.met ? (
                            <Check size={11} color={Colors.dark.tint} style={styles.pillIcon} />
                          ) : (
                            <Circle size={6} color="rgba(255, 255, 255, 0.35)" style={styles.pillDot} />
                          )}
                          <Text style={[styles.pillText, req.met ? styles.pillTextMet : styles.pillTextUnmet]}>
                            {req.shortLabel}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )
                )}


                {/* 6. Confirm Password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Confirm password</Text>
                  <View style={styles.inputRow}>
                    <Lock size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                    <TextInput
                      ref={confirmPasswordRef}
                      keyboardAppearance="dark"
                      style={styles.inputWithAction}
                      placeholder="Confirm your password"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoComplete="new-password"
                      textContentType="newPassword"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      accessibilityLabel="Confirm password"
                      accessibilityHint="Re-enter your password to confirm"
                    />
                    <TouchableOpacity
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={styles.eyeBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      accessibilityState={{ expanded: showConfirmPassword }}
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={20} color="rgba(255,255,255,0.6)" />
                      ) : (
                        <Eye size={20} color="rgba(255,255,255,0.6)" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Password Match Hint */}
                {confirmPassword.length > 0 && (
                  <View style={styles.matchRow}>
                    {password === confirmPassword ? (
                      <>
                        <Check size={13} color={Colors.dark.tint} />
                        <Text style={[styles.matchText, { color: Colors.dark.tint }]}>Passwords match</Text>
                      </>
                    ) : (
                      <>
                        <Circle size={8} color="rgba(255, 255, 255, 0.4)" />
                        <Text style={styles.matchText}>Passwords do not match yet</Text>
                      </>
                    )}
                  </View>
                )}

                {/* Legal Consent Row */}
                <View style={styles.legalConsentRow}>
                  <TouchableOpacity
                    style={[
                      styles.legalCheckbox,
                      legalAccepted && styles.legalCheckboxChecked,
                      !hasReadTerms && styles.legalCheckboxLocked,
                    ]}
                    onPress={() => {
                      if (!hasReadTerms) {
                        showToast('Please read the Terms of Service to the bottom before agreeing.', 'info');
                        setActiveLegalModal('terms');
                        return;
                      }
                      setLegalAccepted((accepted) => !accepted);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityLabel="I agree to the Terms and Conditions and Privacy Policy"
                    accessibilityState={{ checked: legalAccepted, disabled: !hasReadTerms }}
                    accessibilityHint={!hasReadTerms ? 'Opens terms reader to review before agreeing' : undefined}
                  >
                    {legalAccepted && <Text style={styles.legalCheckboxMark}>✓</Text>}
                  </TouchableOpacity>
                  <View style={styles.legalConsentTextContainer}>
                    <Text style={styles.legalConsentText}>
                      I agree to the{' '}
                      <Text
                        style={styles.legalConsentLink}
                        onPress={() => setActiveLegalModal('terms')}
                      >
                        Terms & Conditions
                      </Text>
                      {' '}and{' '}
                      <Text
                        style={styles.legalConsentLink}
                        onPress={() => setActiveLegalModal('privacy')}
                      >
                        Privacy Policy
                      </Text>
                      .
                    </Text>
                    {!hasReadTerms && (
                      <Text style={styles.legalReadPromptText}>
                        (Please read the Terms before agreeing)
                      </Text>
                    )}
                  </View>
                </View>
              </>
            )}

            {/* ─── Login Form (Canonical Keyboard Chaining) ─── */}
            {mode === 'login' && (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Email address or mobile number</Text>
                  <View style={styles.inputRow}>
                    <Mail size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                    <TextInput
                      ref={loginIdentifierRef}
                      keyboardAppearance="dark"
                      style={styles.input}
                      placeholder="Enter your email or mobile"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      value={loginIdentifier}
                      onChangeText={setLoginIdentifier}
                      autoCapitalize="none"
                      autoComplete="username"
                      textContentType="username"
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                      accessibilityLabel="Email address or mobile number"
                      accessibilityHint="Enter your registered email address or mobile number"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.inputRow}>
                    <Lock size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                    <TextInput
                      ref={passwordRef}
                      keyboardAppearance="dark"
                      style={styles.inputWithAction}
                      placeholder="Enter your password"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="current-password"
                      textContentType="password"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      accessibilityLabel="Password"
                      accessibilityHint="Enter your password"
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      accessibilityState={{ expanded: showPassword }}
                    >
                      {showPassword ? (
                        <EyeOff size={20} color="rgba(255,255,255,0.6)" />
                      ) : (
                        <Eye size={20} color="rgba(255,255,255,0.6)" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Login helper buttons */}
                <View style={styles.linksRow}>
                  <TouchableOpacity
                    onPress={() => transitionMode('otp_request')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Log in with a verification code instead"
                  >
                    <Text style={styles.linkText}>Log in with code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => transitionMode('forgot')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                  >
                    <Text style={styles.linkText}>Forgot password?</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ─── Forgot Password / OTP Request ─── */}
            {(mode === 'forgot' || mode === 'otp_request') && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email address</Text>
                <View style={styles.inputRow}>
                  <Mail size={18} color="rgba(255,255,255,0.45)" style={styles.inputIcon} />
                  <TextInput
                    ref={emailRef}
                    keyboardAppearance="dark"
                    style={styles.input}
                    placeholder={mode === 'forgot' ? 'Enter your registered email' : 'Enter your email'}
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    accessibilityLabel="Email address"
                  />
                </View>
              </View>
            )}

            {/* ─── OTP Verification (Email) ─── */}
            {mode === 'otp_verify' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>6-DIGIT CODE</Text>

                {/* Styled OTP boxes */}
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.otpWrapper}
                  onPress={() => otpInputRef.current?.focus()}
                  accessibilityRole="button"
                  accessibilityLabel={`Verification code, ${otpCode.length} of 6 digits entered`}
                  accessibilityHint="Double tap to enter the six digit verification code"
                >
                  {Array.from({ length: 6 }).map((_, index) => {
                    const digit = otpCode[index] || '';
                    const isCurrent = index === otpCode.length;
                    const isActive = isCurrent && inputFocused;

                    return (
                      <View
                        key={index}
                        style={[
                          styles.otpBox,
                          isActive && styles.otpBoxActive,
                        ]}
                      >
                        <Text style={styles.otpBoxText}>{digit}</Text>
                      </View>
                    );
                  })}
                </TouchableOpacity>

                {/* Hidden real input */}
                <TextInput
                  keyboardAppearance="dark"
                  ref={otpInputRef}
                  style={styles.hiddenInput}
                  value={otpCode}
                  onChangeText={handleOtpTextChange}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  accessibilityLabel="Six digit verification code"
                  accessibilityHint="Enter the code sent to your email"
                />

                {/* Resend Code row */}
                <View style={styles.resendRow}>
                  {timer > 0 ? (
                    <Text style={styles.timerText}>Resend code in {timer}s</Text>
                  ) : (
                    <TouchableOpacity
                      onPress={handleResendCode}
                      disabled={loading}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Resend verification code"
                      accessibilityState={{ disabled: loading, busy: loading }}
                    >
                      <Text style={styles.resendText}>Resend Code</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Address Correction: Wrong email? Edit address */}
                {mode === 'otp_verify' && (
                  <TouchableOpacity
                    onPress={() => {
                      setOtpCode('');
                      setTimer(0);
                      transitionMode(verificationType === 'signup' ? 'signup' : 'otp_request');
                    }}
                    style={styles.actionCorrectionButton}
                    accessibilityRole="button"
                    accessibilityLabel="Wrong email? Edit address"
                  >
                    <Edit3 size={14} color={Colors.dark.tint} />
                    <Text style={styles.actionCorrectionText}>Wrong email? Edit address</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Primary CTA Button */}
            <PrimaryButton
              label={getButtonText()}
              onPress={handleSubmit}
              disabled={mode === 'signup' && !legalAccepted}
              loading={loading}
              dark
              style={styles.primaryBtnGlow}
            />

            {mode === 'login' && (
              <Text style={styles.signinNoticeText}>
                By signing in to your account, you agree to our{' '}
                <Text
                  style={styles.legalConsentLink}
                  onPress={() => setActiveLegalModal('terms')}
                >
                  Terms
                </Text>
                {' '}and{' '}
                <Text
                  style={styles.legalConsentLink}
                  onPress={() => setActiveLegalModal('privacy')}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            )}

            {/* Switch between Log In and Sign Up */}
            {(mode === 'login' || mode === 'signup') && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>
                  {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (mode === 'login') setLegalAccepted(false);
                    transitionMode(mode === 'login' ? 'signup' : 'login');
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={mode === 'login' ? 'Create an account' : 'Log in'}
                >
                  <Text style={styles.toggleLink}>
                    {mode === 'login' ? 'Sign Up' : 'Log In'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Switch back from Passwordless OTP request */}
            {mode === 'otp_request' && (
              <TouchableOpacity
                onPress={() => transitionMode('login')}
                style={styles.toggleRow}
                accessibilityRole="button"
                accessibilityLabel="Return to password login"
              >
                <Text style={styles.toggleLabel}>Go back to </Text>
                <Text style={styles.toggleLink}>Password Login</Text>
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
      {activeLegalModal && (
        <LegalReaderModal
          visible={true}
          documentType={activeLegalModal}
          initialViewed={activeLegalModal === 'terms' ? hasReadTerms : false}
          onClose={() => setActiveLegalModal(null)}
          onViewCompleted={() => {
            if (activeLegalModal === 'terms') {
              setHasReadTerms(true);
              setLegalAccepted(true);
            }
          }}
        />
      )}
    </View>
  );
}

const GLASS_BG = 'rgba(255,255,255,0.07)';
const GLASS_BORDER = 'rgba(255,255,255,0.13)';

// Deliberately not theme-aware. The background is a full-bleed photograph under a dark gradient scrim,
// so white text on it is correct whatever the system theme is -- lightening
// it would make that text unreadable.
const c = Colors.dark;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },
  backBtn: {
    position: 'absolute',
    left: 24,
    zIndex: 10,
    padding: Spacing.sm,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingBottom: 40,
  },
  signupStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: 20,
  },
  signupStepPills: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  signupStepPill: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  signupStepPillActive: { backgroundColor: '#fff' },
  signupStepPillDone: { backgroundColor: 'rgba(255,255,255,0.6)' },
  signupStepPillUpcoming: { backgroundColor: 'rgba(255,255,255,0.2)' },
  signupStepCount: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.5,
  },
  headingWrapper: {
    marginBottom: 28,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: 'white',
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: Spacing.sm,
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '400',
    lineHeight: 22,
  },
  glassCard: {
    backgroundColor: GLASS_BG,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    padding: Spacing.xxl,
    gap: 18,
    elevation: 10,
    ...Platform.select({
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.25)' },
    }),
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    // Caps live here, not in the string: a screen reader spells out literal
    // all-caps text letter by letter.
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: 'white',
    paddingVertical: Spacing.md,
  },
  inputWithAction: {
    flex: 1,
    fontSize: 16,
    color: 'white',
    paddingVertical: Spacing.md,
  },
  eyeBtn: {
    padding: Spacing.sm,
  },
  legalConsentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  legalCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  legalCheckboxChecked: {
    backgroundColor: c.tint,
    borderColor: c.tint,
  },
  legalCheckboxLocked: {
    opacity: 0.45,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  legalCheckboxMark: {
    color: c.onTint,
    fontWeight: '800',
    fontSize: 14,
  },
  legalConsentTextContainer: {
    flex: 1,
  },
  legalConsentText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 19,
  },
  legalConsentLink: {
    color: c.tint,
    fontWeight: '700',
  },
  legalReadPromptText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  signinNoticeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  linkText: {
    color: c.tint,
    fontSize: 13,
    fontWeight: '600',
  },
  // Geometry, colour and the disabled state now live in PrimaryButton; what
  // remains is this screen's gold glow, which is not an Elevation token
  // because those cast black.
  primaryBtnGlow: {
    elevation: 6,
    marginTop: Spacing.xs,
    ...Platform.select({
      ios: {
        shadowColor: c.tint,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      web: { boxShadow: '0 4px 10px rgba(0,0,0,0.4)' },
    }),
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  toggleLabel: {
    color: 'rgba(255,255,255,0.45)',
    ...Type.body,
  },
  toggleLink: {
    color: c.tint,
    fontSize: 14,
    fontWeight: '700',
  },
  // OTP Elements
  otpWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 10,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    maxWidth: 50,
    minWidth: 0,
    height: 54,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxActive: {
    borderColor: c.tint,
    backgroundColor: 'rgba(201, 169, 110, 0.08)',
  },
  otpBoxText: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
  },
  hiddenInput: {
    position: 'absolute',
    left: -9999,
    width: 300,
    height: 100,
  },
  resendRow: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  resendText: {
    color: c.tint,
    fontSize: 14,
    fontWeight: '600',
  },
  timerText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '500',
  },

  // Progressive Password Requirements Pills
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -4,
    marginBottom: Spacing.xs,
    paddingLeft: 2,
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 4,
  },
  pillBadgeUnmet: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  pillBadgeMet: {
    backgroundColor: 'rgba(201, 169, 110, 0.12)',
    borderColor: 'rgba(201, 169, 110, 0.35)',
  },
  pillIcon: {
    marginRight: 1,
  },
  pillDot: {
    marginHorizontal: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  pillTextUnmet: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  pillTextMet: {
    color: Colors.dark.tint,
  },

  // Passwords Match
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    paddingLeft: 4,
  },
  matchText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // Address and Mobile Corrections
  actionCorrectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  actionCorrectionText: {
    color: c.tint,
    fontSize: 13,
    fontWeight: '600',
  },
});

