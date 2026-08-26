import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { WishlistProvider } from '@/src/context/WishlistContext';
import { CartProvider } from '@/src/context/CartContext';
import { MessagesProvider } from '@/src/context/MessagesContext';
import { ToastProvider } from '@/src/context/ToastContext';
import { AppThemeProvider, useThemeContext } from '@/src/context/ThemeContext';
import { supabase } from '@/src/lib/supabase';
import { handleRecoveryUrl } from '@/src/utils/recoveryLink';
import { hasSeenOnboarding } from '@/src/utils/onboarding';
import { getPendingDeletionRequest } from '@/src/utils/accountDeletion';
import { PendingDeletionNoticeModal } from '@/src/components/PendingDeletionNoticeModal';
import { initSentry, wrapRootComponent } from '@/src/utils/sentry';
import NetInfo from '@react-native-community/netinfo';

export const unstable_settings = {
  anchor: '(tabs)',
};

// As early as possible, before anything else in the app can throw.
initSentry();

// Held until the auth bootstrap (session + profile) and the onboarding-seen
// check both resolve, so the tabs-anchor screen is never mounted before we
// know the correct first screen to land on.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── Offline Banner ────────────────────────────────────────────────────────────
function OfflineBanner() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-44)).current;

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected || state.isInternetReachable === false;
      setIsOffline(offline);
      Animated.timing(slideAnim, {
        toValue: offline ? 0 : -44,
        duration: 280,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
    return unsub;
  }, [slideAnim]);

  if (!isOffline) return null;
  return (
    <Animated.View
      style={[
        styles.offlineBanner,
        { backgroundColor: colors.warning, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <Text style={styles.offlineBannerText}>⚡ No internet — browsing cached content</Text>
    </Animated.View>
  );
}

function InitialLayout() {
  const { session, isLoading, isProfileLoading, profile, isPasswordRecovery, beginPasswordRecovery, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const themeLoaded = useThemeContext()?.loaded ?? false;

  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  // Latches to true the first time we confirm a fully authenticated + profiled
  // session. Never resets to false within a mount — protects against transient
  // null profile/session states from silent token refreshes kicking the user
  // out of the tabs they are actively navigating.
  const hasAuthenticated = useRef(false);

  // Checked once per cold start, not gated on routing: a pending request
  // shouldn't lock the user out of the app (see account-settings.tsx's own
  // "does not sign you out" copy), just surface once so it isn't silently
  // forgotten in the queue.
  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(null);
  const [pendingDeletionStatus, setPendingDeletionStatus] = useState<'pending' | 'auth_revocation_pending' | null>(null);
  const [deletionNoticeDismissed, setDeletionNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!session?.user?.id) {
      setPendingDeletionId(null);
      setPendingDeletionStatus(null);
      return;
    }
    let cancelled = false;
    getPendingDeletionRequest(session.user.id).then((req) => {
      if (!cancelled) {
        setPendingDeletionId(req?.id ?? null);
        setPendingDeletionStatus(req?.status ?? null);
      }
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Handle password-recovery deep links (both a cold start from the link and
  // the app already running in the background when it's tapped).
  useEffect(() => {
    Linking.getInitialURL().then(async (url) => {
      if (await handleRecoveryUrl(url)) {
        beginPasswordRecovery();
        router.replace('/(auth)/reset-password' as any);
      }
    });

    const subscription = Linking.addEventListener('url', async ({ url }) => {
      if (await handleRecoveryUrl(url)) {
        beginPasswordRecovery();
        router.replace('/(auth)/reset-password' as any);
      }
    });

    return () => subscription.remove();
  }, [router, beginPasswordRecovery]);

  useEffect(() => {
    hasSeenOnboarding().then(setOnboardingSeen);
  }, []);

  // Gates the redirect effect on every run (same as before, so a later
  // refreshProfile() call still pauses redirects while it's in flight).
  const flagsReady = !isLoading && !isProfileLoading && onboardingSeen !== null && themeLoaded;

  // Gates whether the Stack renders at all -- but only for the very first
  // cold-start bootstrap. Flips true once and never back to false, so a
  // later refreshProfile() call (e.g. from profile-setup) can't unmount the
  // whole navigator out from under the screen the user is currently on.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);
  useEffect(() => {
    if (flagsReady && !hasBootstrapped) setHasBootstrapped(true);
  }, [flagsReady, hasBootstrapped]);

  // Flips once the redirect effect has picked a route. Latches true so a later
  // refreshProfile cannot drop the cover back over a screen the user is on.
  const [routeSettled, setRouteSettled] = useState(false);

  // Deliberately useEffect, not useLayoutEffect. Layout effects run before the
  // Stack below has registered with expo-router, so redirecting from one threw
  // "Attempted to navigate before mounting the Root Layout component" -- on
  // cold start and again on sign-out. useRootNavigationState is not a usable
  // guard for it either: it reports expo-router's own root navigator, which
  // exists well before this Stack does, so its key is already truthy while
  // assertIsReady still fails.
  //
  // The flash that motivated useLayoutEffect is instead handled by the overlay
  // below, which stays up until this has settled on a route.
  useEffect(() => {
    const pathSegments = segments as string[];
    const inAuthGroup = pathSegments[0] === '(auth)';
    const inTabsGroup = pathSegments[0] === '(tabs)';
    const onProfileSetup = pathSegments[1] === 'profile-setup';
    const onResetPassword = pathSegments[1] === 'reset-password';

    // CRITICAL: If we've already confirmed a fully authenticated session at
    // least once this mount, AND the user is inside the app (not in auth), skip ALL
    // redirects. Supabase silent token refreshes and syncProfile() calls
    // temporarily set isProfileLoading=true (making flagsReady=false) and can
    // transiently null out profile — which would otherwise redirect the user
    // back to auth/home while they're navigating anywhere in the app.
    if (hasAuthenticated.current && !inAuthGroup && !isPasswordRecovery && !profile?.deleted) {
      setRouteSettled(true);
      return;
    }

    // For the initial bootstrap, wait until all async flags are resolved.
    if (!flagsReady) return;

    // A recovery session is a real session, so without this the emailed reset
    // link would function as a full login: satisfy the branches below, reach
    // the tabs, and never require a new password. Pin the user here until
    // updateUser succeeds (or they sign out from the screen itself).
    if (isPasswordRecovery) {
      if (!onResetPassword) router.replace('/(auth)/reset-password' as any);
    } else if (profile?.deleted) {
      signOut();
    } else if (!session) {
      // Require authentication — guests must create an account or sign in.
      if (!inAuthGroup) {
        router.replace(onboardingSeen ? '/(auth)/welcome' : '/(auth)');
      }
    } else {
      // User is logged in
      if (!profile || !profile.first_name) {
        if (!onProfileSetup) router.replace('/(auth)/profile-setup');
      } else {
        // Fully authenticated with a complete profile — latch the flag so
        // future tab switches and token refreshes never trigger a redirect.
        hasAuthenticated.current = true;
        if (inAuthGroup) {
          router.replace('/(tabs)');
        }
      }
    }

    // Whichever branch ran, the correct route is now committed.
    setRouteSettled(true);
  }, [flagsReady, session, segments, profile, router, onboardingSeen, isPasswordRecovery, signOut]);

  useEffect(() => {
    if (hasBootstrapped) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasBootstrapped]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
      </Stack>
      {/* Covers the Stack rather than replacing it. Returning a bare View here
          meant the root layout rendered no navigator on its first pass, so the
          redirect below threw "Attempted to navigate before mounting the Root
          Layout component". Overlaying keeps the same guarantee -- the tabs are
          never visible for a frame -- while the navigator still mounts. */}
      {!routeSettled && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, zIndex: 999 }]}
        />
      )}
      {routeSettled && pendingDeletionId && !deletionNoticeDismissed && (
        <PendingDeletionNoticeModal
          visible
          requestId={pendingDeletionId}
          status={pendingDeletionStatus ?? 'pending'}
          onResolved={() => {
            setPendingDeletionId(null);
            setPendingDeletionStatus(null);
            setDeletionNoticeDismissed(true);
          }}
          onDismiss={() => setDeletionNoticeDismissed(true)}
        />
      )}
      <OfflineBanner />
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

function RootLayout() {
  // GestureHandlerRootView must wrap the whole tree for react-native-gesture-handler
  // to receive touches on Android; iOS auto-wraps but Android does not.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* android.edgeToEdgeEnabled draws the app behind the status bar, so real
          insets are the only correct top offset. React Navigation supplies a
          compat provider per-screen, but not above these context providers --
          ToastContext needs insets too, and was using a hardcoded guess. */}
      <SafeAreaProvider>
        {/* Outermost of the app providers: ToastProvider and every screen below
            it call useColorScheme, which reads the override from here. */}
        <AppThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <WishlistProvider>
                <CartProvider>
                  <MessagesProvider>
                    <InitialLayout />
                  </MessagesProvider>
                </CartProvider>
              </WishlistProvider>
            </AuthProvider>
          </ToastProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRootComponent(RootLayout);

const styles = StyleSheet.create({
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  offlineBannerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
