import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Platform,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Colors, Spacing } from '@/constants/theme';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { PrimaryButton } from '@/src/components/PrimaryButton';

// Required to dismiss the auth session on iOS
WebBrowser.maybeCompleteAuthSession();

const { height } = Dimensions.get('window');

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?q=85&w=1200&auto=format&fit=crop';
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;

// Official Google "G" logo with correct brand colors
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

export default function WelcomeScreen() {
  const { showToast } = useToast();
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const [legalDoc, setLegalDoc] = React.useState<{ label: string; url: string } | null>(null);

  const openLegalDocument = async (label: string, url?: string) => {
    if (!url) {
      showToast(`${label} link is not configured yet.`, 'info');
      return;
    }
    try {
      if (Platform.OS === 'web') {
        setLegalDoc({ label, url });
      } else {
        await WebBrowser.openBrowserAsync(url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      }
    } catch {
      showToast(`Could not open the ${label}.`, 'error');
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'web') {
        const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
          },
        });
        if (error) throw error;
        return;
      }

      // Linking.createURL generates the correct deep link for the current environment:
      //   Expo Go  → exp://192.168.x.x:8081/--/auth/callback
      //   Dev build → jezsymobileapp://auth/callback
      const redirectTo = Linking.createURL('auth/callback');

      if (__DEV__) console.log('[OAuth] redirectTo:', redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      // Open the OAuth URL in an in-app browser.
      // The second argument tells the browser which URL pattern signals "we're done".
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      console.log('[OAuth] Browser result:', result.type);

      if (result.type === 'success' && result.url) {
        console.log('[OAuth] Callback URL received:', result.url.substring(0, 80) + '...');

        // Supabase appends tokens as a hash fragment: #access_token=...&refresh_token=...
        const fragment = result.url.split('#')[1];

        if (fragment) {
          const params = new URLSearchParams(fragment);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
            // AuthContext listener will detect the new session and route accordingly
          } else {
            console.warn('[OAuth] No tokens found in callback URL fragment');
            // Check if there's an error in the fragment
            const errorDesc = params.get('error_description');
            if (errorDesc) {
              throw new Error(errorDesc);
            }
          }
        } else {
          console.warn('[OAuth] No hash fragment in callback URL');
        }
      } else if (result.type === 'dismiss' || result.type === 'cancel') {
        // User closed the browser — not an error, just stop loading
        console.log('[OAuth] User dismissed the browser');
      }
    } catch (err: any) {
      console.error('Google Sign-In error:', err);
      showToast(err.message ?? 'Could not sign in with Google. Please try again.', 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Full-screen background image */}
      <Image
        source={HERO_IMAGE}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={600}
      />

      {/* Multi-stop gradient overlay */}
      <LinearGradient
        colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)', 'rgba(13,13,13,0.97)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Branding */}
      <View style={styles.brandingContainer}>
        <Text style={styles.brandLogo}>JezSy</Text>
        <Text style={styles.brandTagline}>Your personal fashion collection</Text>
      </View>

      {/* CTA buttons at bottom */}
      <View style={styles.ctaContainer}>
        {/* Google Sign In */}
        <TouchableOpacity
          style={[styles.googleButton, googleLoading && styles.btnDisabled]}
          activeOpacity={0.85}
          onPress={handleGoogleSignIn}
          disabled={googleLoading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: googleLoading, busy: googleLoading }}
        >
          {googleLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <GoogleLogo />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Email Sign In */}
        <PrimaryButton
          label="Continue with Email"
          onPress={() => router.push('/(auth)/auth')}
          dark
        />

        <View style={styles.termsRow}>
          <Text style={styles.termsText}>By continuing, you agree to our </Text>
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel="Terms of Service"
            onPress={() => openLegalDocument('Terms of Service', TERMS_URL)}
          >
            <Text style={styles.termsLink}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={styles.termsText}> and </Text>
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
            onPress={() => openLegalDocument('Privacy Policy', PRIVACY_URL)}
          >
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Web Legal Modal */}
      {Platform.OS === 'web' && legalDoc && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setLegalDoc(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{legalDoc.label}</Text>
                <TouchableOpacity onPress={() => setLegalDoc(null)} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
              {/* @ts-ignore */}
              <iframe
                src={legalDoc.url}
                style={{ flex: 1, width: '100%', height: '100%', border: 'none' }}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// Deliberately not theme-aware. The background is a full-bleed photograph
// under a dark gradient scrim, so white text on it is correct whatever the
// system theme is -- lightening the scrim would make that text unreadable.
// The dark palette is read directly rather than via useColorScheme.
const c = Colors.dark;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  brandingContainer: {
    position: 'absolute',
    bottom: height * 0.38,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  brandLogo: {
    fontSize: 52,
    fontWeight: '800',
    color: c.tint,
    letterSpacing: 4,
    marginBottom: 6,
  },
  brandTagline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1,
    fontWeight: '400',
  },
  ctaContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingBottom: 50,
    paddingTop: Spacing.xl,
    gap: Spacing.md,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    height: 56,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xs,
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dividerText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
  emailButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.tint,
    borderRadius: 14,
    height: 56,
  },
  emailButtonText: {
    color: c.onTint,
    fontSize: 16,
    fontWeight: '700',
  },
  termsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  termsText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    lineHeight: 18,
  },
  termsLink: {
    color: c.tint,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxWidth: 600,
    height: '80%',
    backgroundColor: '#121212',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#1C1C1E',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  closeBtnText: {
    color: c.tint,
    fontSize: 16,
    fontWeight: '600',
  },
});
