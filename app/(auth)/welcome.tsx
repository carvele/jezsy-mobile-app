import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Colors } from '@/constants/theme';
import { supabase } from '@/src/lib/supabase';

// Required to dismiss the auth session on iOS
WebBrowser.maybeCompleteAuthSession();

const { height } = Dimensions.get('window');

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?q=85&w=1200&auto=format&fit=crop';

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
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = React.useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      // Linking.createURL generates the correct deep link for the current environment:
      //   Expo Go  → exp://192.168.x.x:8081/--/auth/callback
      //   Dev build → jezsymobileapp://auth/callback
      const redirectTo = Linking.createURL('auth/callback');

      console.log('[OAuth] redirectTo:', redirectTo);

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
      Alert.alert('Sign In Failed', err.message ?? 'Could not sign in with Google. Please try again.');
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
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        transition={600}
      />

      {/* Multi-stop gradient overlay */}
      <LinearGradient
        colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)', 'rgba(10,10,10,0.97)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
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
        <TouchableOpacity
          style={styles.emailButton}
          activeOpacity={0.85}
          onPress={() => router.push('/(auth)/auth')}
        >
          <Text style={styles.emailButtonText}>Continue with Email</Text>
        </TouchableOpacity>

        <Text style={styles.termsText}>
          By continuing, you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> &{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
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
    color: Colors.dark.tint,
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
    paddingTop: 20,
    gap: 12,
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
    marginVertical: 4,
    gap: 12,
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
    backgroundColor: Colors.dark.tint,
    borderRadius: 14,
    height: 56,
  },
  emailButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
  termsText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  termsLink: {
    color: Colors.dark.tint,
    fontWeight: '600',
  },
});
