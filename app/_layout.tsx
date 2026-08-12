import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, AppState } from 'react-native';
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
import { registerOfflineSyncListener } from '@/src/services/offlineSync';
import NetInfo from '@react-native-community/netinfo';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Held until the auth bootstrap (session + profile) and the onboarding-seen
// check both resolve, so the tabs-anchor screen is never mounted before we
// know the correct first screen to land on.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── Offline Banner ────────────────────────────────────────────────────────────
function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-44)).current;

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected || state.isInternetReachable === false;
      setIsOffline(offline);
      Animated.timing(slideAnim, {
        toValue: offline ? 0 : -44,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
    return unsub;
  }, [slideAnim]);

  if (!isOffline) return null;
  return (
    <Animated.View
      style={[
        styles.offlineBanner,
        { transform: [{ translateY: slideAnim }] },
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

  // Checked once per cold start, not gated on routing: a pending request
  // shouldn't lock the user out of the app (see account-settings.tsx's own
  // "does not sign you out" copy), just surface once so it isn't silently
  // forgotten in the queue.
  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(null);
  const [deletionNoticeDismissed, setDeletionNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!session?.user?.id) {
      setPendingDeletionId(null);
      return;
    }
    let cancelled = false;
    getPendingDeletionRequest(session.user.id).then((req) => {
      if (!cancelled) setPendingDeletionId(req?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Activity Heartbeat — keeps admin dashboard "Last active" & green dot accurately synced
  // Only pings when the app is in the foreground to avoid battery drain.
  useEffect(() => {
    if (!session?.user?.id) return;
    let interval: ReturnType<typeof setInterval> | null = null;

    const updateActivityPing = async () => {
      const nowIso = new Date().toISOString();
      await (supabase
        .from('profiles')
        .update({ updated_at: nowIso, last_online: nowIso, last_activity: nowIso } as any)
        .eq('id', session.user.id));
    };

    const startPinging = () => {
      updateActivityPing();
      interval = setInterval(updateActivityPing, 2 * 60 * 1000);
    };

    const stopPinging = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    // Only ping when app is in foreground
    if (AppState.currentState === 'active') startPinging();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') startPinging();
      else stopPinging();
    });

    return () => { stopPinging(); sub.remove(); };
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
    if (!flagsReady) return;

    const pathSegments = segments as string[];
    const inAuthGroup = pathSegments[0] === '(auth)';
    const onProfileSetup = pathSegments[1] === 'profile-setup';
    const onResetPassword = pathSegments[1] === 'reset-password';

    // A recovery session is a real session, so without this the emailed reset
    // link would function as a full login: satisfy the branches below, reach
    // the tabs, and never require a new password. Pin the user here until
    // updateUser succeeds (or they sign out from the screen itself).
    if (isPasswordRecovery) {
      if (!onResetPassword) router.replace('/(auth)/reset-password' as any);
    } else if (!session) {
      if (!inAuthGroup) {
        // Returning (or already-onboarded) users skip straight past the
        // marketing carousel to the login/welcome screen.
        router.replace(onboardingSeen ? '/(auth)/welcome' : '/(auth)');
      }
    } else if (profile?.deleted) {
      // Staff already erased this account server-side (process_account_deletion
      // scrubs profiles and sets deleted=true, but does not itself end the
      // session -- that happens on a best-effort second step that can fail).
      // A lingering session on a scrubbed, nameless profile would otherwise
      // fall into the !profile.first_name branch below and route to
      // profile-setup, letting the customer "revive" a profile staff just
      // deleted. Sign out instead of routing anywhere in the app.
      signOut();
    } else {
      // User is logged in
      if (!profile || !profile.first_name) {
        if (!onProfileSetup) router.replace('/(auth)/profile-setup');
      } else {
        // Fully authenticated and set up
        if (inAuthGroup) {
          router.replace('/(tabs)');
        }
      }
    }

    // Whichever branch ran, the correct route is now committed, so the cover
    // can come down without exposing the default route for a frame.
    setRouteSettled(true);
  }, [flagsReady, session, segments, profile, router, onboardingSeen, isPasswordRecovery, signOut]);

  useEffect(() => {
    if (hasBootstrapped) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasBootstrapped]);

  // Register global offline-sync listener. Flushes the local order queue as
  // soon as connectivity is restored. Cleaned up on unmount (hot reload etc.).
  useEffect(() => {
    const unsubscribe = registerOfflineSyncListener();
    return unsubscribe;
  }, []);

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
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
      )}
      {routeSettled && pendingDeletionId && !deletionNoticeDismissed && (
        <PendingDeletionNoticeModal
          visible
          requestId={pendingDeletionId}
          onResolved={() => {
            setPendingDeletionId(null);
            setDeletionNoticeDismissed(true);
          }}
          onDismiss={() => setDeletionNoticeDismissed(true)}
        />
      )}
      <OfflineBanner />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
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

const styles = StyleSheet.create({
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 44,
    backgroundColor: '#B45309',
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
