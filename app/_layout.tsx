import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';
import * as Linking from 'expo-linking';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { WishlistProvider } from '@/src/context/WishlistContext';
import { CartProvider } from '@/src/context/CartContext';
import { MessagesProvider } from '@/src/context/MessagesContext';
import { handleRecoveryUrl } from '@/src/utils/recoveryLink';

export const unstable_settings = {
  anchor: '(tabs)',
};

function InitialLayout() {
  const { session, isLoading, isProfileLoading, profile, hasPinSetup, isPinAuthenticated, requireFullLogin } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();

  // Handle password-recovery deep links (both a cold start from the link and
  // the app already running in the background when it's tapped).
  useEffect(() => {
    Linking.getInitialURL().then(async (url) => {
      if (await handleRecoveryUrl(url)) {
        router.replace('/(auth)/reset-password' as any);
      }
    });

    const subscription = Linking.addEventListener('url', async ({ url }) => {
      if (await handleRecoveryUrl(url)) {
        router.replace('/(auth)/reset-password' as any);
      }
    });

    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (isLoading || isProfileLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onProfileSetup = segments[1] === 'profile-setup';
    const onPinSetup = segments[1] === 'pin-setup';
    const onPinEntry = segments[1] === 'pin-entry';
    const onResetPassword = (segments[1] as string) === 'reset-password';

    // A recovery session is a real (temporary) session, so it would
    // otherwise satisfy every branch below and get redirected straight past
    // this screen into the tabs/PIN flow before the user sets a new password.
    if (onResetPassword) return;

    if (!session || requireFullLogin) {
      if (!inAuthGroup) {
        router.replace('/(auth)');
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
  }, [session, isLoading, isProfileLoading, segments, profile, router, hasPinSetup, isPinAuthenticated, requireFullLogin]);

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
