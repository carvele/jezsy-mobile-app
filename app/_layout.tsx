import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { WishlistProvider } from '@/src/context/WishlistContext';
import { CartProvider } from '@/src/context/CartContext';
import { MessagesProvider } from '@/src/context/MessagesContext';
import { hasSeenOnboarding } from '@/src/utils/onboarding';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Held until the auth bootstrap (session + PIN/profile flags) and the
// onboarding-seen check both resolve, so the tabs-anchor screen is never
// mounted before we know the correct first screen to land on.
SplashScreen.preventAutoHideAsync().catch(() => {});

function InitialLayout() {
  const { session, isLoading, isProfileLoading, profile, hasPinSetup, isPinAuthenticated, requireFullLogin } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'dark'];

  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    hasSeenOnboarding().then(setOnboardingSeen);
  }, []);

  // Gates the redirect effect on every run (same as before, so a later
  // refreshProfile() call still pauses redirects while it's in flight).
  const flagsReady = !isLoading && !isProfileLoading && onboardingSeen !== null;

  // Gates whether the Stack renders at all -- but only for the very first
  // cold-start bootstrap. Flips true once and never back to false, so a
  // later refreshProfile() call (e.g. from profile-setup) can't unmount the
  // whole navigator out from under the screen the user is currently on.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useEffect(() => {
    if (flagsReady && !hasBootstrapped) setHasBootstrapped(true);
  }, [flagsReady, hasBootstrapped]);

  useEffect(() => {
    if (!flagsReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onProfileSetup = segments[1] === 'profile-setup';
    const onPinSetup = segments[1] === 'pin-setup';
    const onPinEntry = segments[1] === 'pin-entry';

    if (!session || requireFullLogin) {
      if (!inAuthGroup) {
        // Returning (or already-onboarded) users skip straight past the
        // marketing carousel to the login/welcome screen.
        router.replace(onboardingSeen ? '/(auth)/welcome' : '/(auth)');
      }
    } else {
      // User is logged in
      if (!profile || !profile.first_name) {
        if (!onProfileSetup) router.replace('/(auth)/profile-setup');
      } else if (!hasPinSetup) {
        if (!onPinSetup) router.replace('/(auth)/pin-setup');
      } else if (!isPinAuthenticated) {
        if (!onPinEntry) router.replace('/(auth)/pin-entry');
      } else {
        // Fully authenticated and set up
        if (inAuthGroup) {
          router.replace('/(tabs)');
        }
      }
    }
  }, [flagsReady, session, segments, profile, router, hasPinSetup, isPinAuthenticated, requireFullLogin, onboardingSeen]);

  useEffect(() => {
    if (hasBootstrapped) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasBootstrapped]);

  if (!hasBootstrapped) {
    // Bare, theme-matched placeholder -- shown for at most a frame or two
    // beneath the still-visible native splash, never the tabs/Home screen.
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <WishlistProvider>
        <CartProvider>
          <MessagesProvider>
            <InitialLayout />
          </MessagesProvider>
        </CartProvider>
      </WishlistProvider>
    </AuthProvider>
  );
}
