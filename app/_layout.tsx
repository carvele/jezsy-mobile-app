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
  const { session, isLoading, isProfileLoading, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (isLoading || isProfileLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onProfileSetup = segments[1] === 'profile-setup';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)');
    } else if (session && inAuthGroup && !onProfileSetup) {
      if (!profile || !profile.first_name) {
        router.replace('/(auth)/profile-setup');
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && !inAuthGroup) {
      if (!profile || !profile.first_name) {
        router.replace('/(auth)/profile-setup');
      }
    }
  }, [session, isLoading, isProfileLoading, segments, profile, router]);

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
