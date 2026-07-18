import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { WishlistProvider } from '@/src/context/WishlistContext';
import { CartProvider } from '@/src/context/CartContext';
import { MessagesProvider } from '@/src/context/MessagesContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function InitialLayout() {
  const { session, isLoading, isProfileLoading, profile, hasPinSetup, isPinAuthenticated, requireFullLogin } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (isLoading || isProfileLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onProfileSetup = segments[1] === 'profile-setup';
    const onPinSetup = segments[1] === 'pin-setup';
    const onPinEntry = segments[1] === 'pin-entry';

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
