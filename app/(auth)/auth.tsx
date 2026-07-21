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
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
  Dimensions,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { supabase } from '@/src/lib/supabase';
import { Colors } from '@/constants/theme';
import { ArrowLeft, Eye, EyeOff, Mail, Lock } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}


const { width } = Dimensions.get('window');

// Curated editorial fashion image for the glassmorphism background
const BG_IMAGE =
  'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=85&w=1200&auto=format&fit=crop';

type Mode = 'login' | 'signup' | 'otp_request' | 'otp_verify' | 'forgot';
type VerificationType = 'signup' | 'login';

export default function AuthScreen() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('login');
  const [verificationType, setVerificationType] = useState<VerificationType>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [timer, setTimer] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  const otpInputRef = useRef<TextInput>(null);

  // Timer countdown handler for OTP resend
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer(t => t - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  // Focus the hidden OTP input when transitioning to 'otp_verify' step
  useEffect(() => {
    if (mode === 'otp_verify') {
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 250);
    }
  }, [mode]);

  const transitionMode = useCallback((nextMode: Mode) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setOtpCode('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, []);

  const validateEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

  // ─── Sign Up (Email + Password) ──────────────────────
  const handleSignUp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { lookup_email: trimmedEmail });
      if (!rpcError && emailExists) {
        Alert.alert('Sign Up Failed', 'Email already registered. Please log in instead.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) throw error;

      // If user is already logged in (confirm email was turned off)
      if (data?.session) {
        // Auth state change listener will handle routing automatically
        return;
      }

      // If confirm email is ON, we transition to OTP verification mode
      setVerificationType('signup');
      setTimer(60);
      transitionMode('otp_verify');
    } catch (err: any) {
      console.error('Sign Up error:', err);
      let msg = err.message ?? 'Could not create your account.';
      if (msg.includes('already registered')) {
        msg = 'This email is already registered. Please log in instead.';
      }
      Alert.alert('Sign Up Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Log In (Email + Password) ───────────────────────
  const handlePasswordLogin = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!password) {
      Alert.alert('Missing Password', 'Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { lookup_email: trimmedEmail });
      if (!rpcError && !emailExists) {
        Alert.alert('Login Failed', 'Email not found. Please sign up first.');
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) throw error;

      await SecureStore.setItemAsync('jezsy_last_full_login', new Date().toISOString());

      // Auth state listener handles routing
    } catch (err: any) {
      console.error('Login error:', err);
      let msg = err.message ?? 'Could not sign in.';
      if (msg.includes('Invalid login credentials')) {
        msg = 'Incorrect email or password. Please try again.';
      } else if (msg.includes('Email not confirmed')) {
        // Switch to OTP verification if email is not confirmed
        setVerificationType('signup');
        setTimer(60);
        transitionMode('otp_verify');
        return;
      }
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Request Passwordless OTP Code ───────────────────
  const handleRequestOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { lookup_email: trimmedEmail });
      if (!rpcError && !emailExists) {
        Alert.alert('Sign In Failed', 'Email not found. Please sign up first.');
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
      });

      if (error) throw error;

      setVerificationType('login');
      setTimer(60);
      transitionMode('otp_verify');
    } catch (err: any) {
      console.error('Send OTP error:', err);
      let errorMessage = err.message ?? 'Could not send verification code.';
      if (errorMessage.includes('rate limit')) {
        errorMessage = 'You have requested too many codes recently. Please try again later.';
      }
      Alert.alert('Sign In Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ─── Verify OTP Code (Handles Sign Up & Log In) ──────
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify ?? otpCode;
    if (code.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: verificationType === 'signup' ? 'signup' : 'email',
      });

      if (error) throw error;

      await SecureStore.setItemAsync('jezsy_last_full_login', new Date().toISOString());

      // AuthState change listener in root layout will automatically handle routing
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      Alert.alert('Verification Failed', err.message ?? 'The code entered is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Resend Code ─────────────────────────────────────
  const handleResendCode = async () => {
    if (timer > 0) return;
    setLoading(true);
    try {
      const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { lookup_email: email.trim().toLowerCase() });

      if (verificationType === 'signup') {
        if (!rpcError && emailExists) {
          Alert.alert('Sign Up Failed', 'Email already registered. Please log in instead.');
          setLoading(false);
          return;
        }

        // Resend signup confirmation by signing up again (handles resending)
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      } else {
        if (!rpcError && !emailExists) {
          Alert.alert('Resend Failed', 'Email not found. Please sign up first.');
          setLoading(false);
          return;
        }

        // Resend passwordless login OTP
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
        });
        if (error) throw error;
      }

      setTimer(60);
      setOtpCode('');
      Alert.alert('Code Resent', 'A new 6-digit verification code has been sent to your email.');
    } catch (err: any) {
      console.error('Resend OTP error:', err);
      let errorMessage = err.message ?? 'Could not resend verification code.';
      if (errorMessage.includes('rate limit')) {
        errorMessage = 'You have requested too many codes recently. Please try again later.';
      }
      Alert.alert('Resend Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ─── Forgot Password ────────────────────────────────
  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { lookup_email: trimmedEmail });
      if (!rpcError && !emailExists) {
        Alert.alert('Reset Failed', 'Email not found. Please sign up first.');
        setLoading(false);
        return;
      }

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
      let msg = err.message ?? 'Could not send reset email.';
      if (msg.includes('rate limit')) {
        msg = 'Too many requests. Please try again later.';
      }
      Alert.alert('Reset Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Dynamic UI Texts ───────────────────────────────
  const getTitle = () => {
    switch (mode) {
      case 'login':       return 'Welcome\nback.';
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
      <Image source={BG_IMAGE} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      <LinearGradient
        colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.75)', 'rgba(10,10,10,0.98)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.7}>
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Dynamic heading */}
          <View style={styles.headingWrapper}>
            <Text style={styles.title}>{getTitle()}</Text>
            <Text style={styles.subtitle}>{getSubtitle()}</Text>
          </View>

          {/* Glassmorphism card */}
          <View style={styles.glassCard}>
            
            {/* Email Field (visible on all screens except otp_verify) */}
            {mode !== 'otp_verify' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>EMAIL</Text>
                <View style={styles.inputRow}>
                  <Mail size={18} color="rgba(255,255,255,0.35)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    returnKeyType={mode === 'forgot' || mode === 'otp_request' ? 'done' : 'next'}
                    onSubmitEditing={mode === 'forgot' || mode === 'otp_request' ? handleSubmit : undefined}
                  />
                </View>
              </View>
            )}

            {/* Password Field (login & signup) */}
            {(mode === 'login' || mode === 'signup') && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>PASSWORD</Text>
                <View style={styles.inputRow}>
                  <Lock size={18} color="rgba(255,255,255,0.35)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithAction}
                    placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Enter password'}
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    returnKeyType={mode === 'signup' ? 'next' : 'done'}
                    onSubmitEditing={mode === 'login' ? handleSubmit : undefined}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {showPassword ? (
                      <EyeOff size={20} color="rgba(255,255,255,0.4)" />
                    ) : (
                      <Eye size={20} color="rgba(255,255,255,0.4)" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Confirm Password (signup only) */}
            {mode === 'signup' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>CONFIRM PASSWORD</Text>
                <View style={styles.inputRow}>
                  <Lock size={18} color="rgba(255,255,255,0.35)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithAction}
                    placeholder="Re-enter password"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={20} color="rgba(255,255,255,0.4)" />
                    ) : (
                      <Eye size={20} color="rgba(255,255,255,0.4)" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* OTP Verification Steps (only in otp_verify screen) */}
            {mode === 'otp_verify' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>6-DIGIT CODE</Text>

                {/* Styled OTP boxes */}
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.otpWrapper}
                  onPress={() => otpInputRef.current?.focus()}
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
                  ref={otpInputRef}
                  style={styles.hiddenInput}
                  value={otpCode}
                  onChangeText={handleOtpTextChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                />

                {/* Resend Code row */}
                <View style={styles.resendRow}>
                  {timer > 0 ? (
                    <Text style={styles.timerText}>Resend code in {timer}s</Text>
                  ) : (
                    <TouchableOpacity onPress={handleResendCode} disabled={loading}>
                      <Text style={styles.resendText}>Resend Code</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Login helper buttons (forgot password / OTP switch) */}
            {mode === 'login' && (
              <View style={styles.linksRow}>
                <TouchableOpacity onPress={() => transitionMode('otp_request')}>
                  <Text style={styles.linkText}>Log in with code instead</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => transitionMode('forgot')}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Primary CTA Button */}
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0D0D0D" />
              ) : (
                <Text style={styles.primaryBtnText}>{getButtonText()}</Text>
              )}
            </TouchableOpacity>

            {/* Switch between Log In and Sign Up */}
            {(mode === 'login' || mode === 'signup') && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>
                  {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                </Text>
                <TouchableOpacity
                  onPress={() => transitionMode(mode === 'login' ? 'signup' : 'login')}
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
              >
                <Text style={styles.toggleLabel}>Go back to </Text>
                <Text style={styles.toggleLink}>Password Login</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const GLASS_BG = 'rgba(255,255,255,0.07)';
const GLASS_BORDER = 'rgba(255,255,255,0.13)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  flex: { flex: 1 },
  backBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 58 : 40,
    left: 24,
    zIndex: 10,
    padding: 8,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: Platform.OS === 'ios' ? 100 : 80,
  },
  headingWrapper: {
    marginBottom: 28,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '400',
    lineHeight: 22,
  },
  glassCard: {
    backgroundColor: GLASS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    padding: 24,
    gap: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
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
    color: '#fff',
    paddingVertical: 12,
  },
  inputWithAction: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    paddingVertical: 12,
  },
  eyeBtn: {
    padding: 8,
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  linkText: {
    color: Colors.dark.tint,
    fontSize: 13,
    fontWeight: '600',
  },
  primaryBtn: {
    height: 56,
    backgroundColor: Colors.dark.tint,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.dark.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
    marginTop: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
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
    fontSize: 14,
    fontWeight: '400',
  },
  toggleLink: {
    color: Colors.dark.tint,
    fontSize: 14,
    fontWeight: '700',
  },
  // OTP Elements
  otpWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 10,
  },
  otpBox: {
    width: (width - 48 - 48 - 40) / 6,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxActive: {
    borderColor: Colors.dark.tint,
    backgroundColor: 'rgba(201, 169, 110, 0.08)',
  },
  otpBoxText: {
    color: '#fff',
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
    marginTop: 8,
  },
  resendText: {
    color: Colors.dark.tint,
    fontSize: 14,
    fontWeight: '600',
  },
  timerText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '500',
  },
});
