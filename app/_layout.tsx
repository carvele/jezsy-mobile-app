import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform, LogBox, ActivityIndicator } from 'react-native';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
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
import { handleRecoveryUrl } from '@/src/utils/recoveryLink';
import { hasSeenOnboarding } from '@/src/utils/onboarding';
import { getPendingDeletionRequest } from '@/src/utils/accountDeletion';
import { PendingDeletionNoticeModal } from '@/src/components/PendingDeletionNoticeModal';
import { initWebUpdateChecker } from '@/src/utils/webUpdateChecker';
import NetInfo from '@react-native-community/netinfo';

LogBox.ignoreLogs([
  'AuthApiError: Invalid Refresh Token: Refresh Token Not Found',
  'Invalid Refresh Token',
  'AuthSessionMissingError',
  'FunctionsHttpError',
  'setLayoutAnimationEnabledExperimental is currently a no-op',
  '"shadow*" style props are deprecated. Use "boxShadow".',
  'props.pointerEvents is deprecated. Use style.pointerEvents',
  'React does not recognize the `accessibilityElementsHidden` prop',
  'React does not recognize the `importantForAccessibility` prop',
  'Image: style.resizeMode is deprecated. Please use props.resizeMode.',
]);

// react-native-web and React DOM emit known harmless dev notices on web that bypass LogBox.
// Patch console.warn and console.error on web to filter out these platform translation warnings.
if (Platform.OS === 'web' && typeof console !== 'undefined') {
  const IGNORED_PATTERNS = [
    'props.pointerEvents is deprecated',
    '"shadow*" style props are deprecated',
    'accessibilityElementsHidden',
    'importantForAccessibility',
    'cannot be a descendant of <button>',
    'cannot contain a nested <button>',
    'style.resizeMode is deprecated',
  ];

  const shouldSuppress = (...args: unknown[]) => {
    const combined = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
    return IGNORED_PATTERNS.some((pattern) => combined.includes(pattern));
  };

  const _origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(...args)) return;
    _origWarn(...args);
  };

  const _origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (shouldSuppress(...args)) return;
    _origError(...args);
  };

  // Automatically blur focused elements when their ancestor container is marked aria-hidden
  // (e.g. during screen/tab transitions in React Navigation) to prevent browser a11y warnings.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'aria-hidden' &&
          (mutation.target as HTMLElement).getAttribute('aria-hidden') === 'true'
        ) {
          const target = mutation.target as HTMLElement;
          if (document.activeElement && target.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur?.();
          }
        }
      }
    });

    const initObserver = () => {
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: ['aria-hidden'],
        });
      } else {
        setTimeout(initObserver, 50);
      }
    };
    initObserver();
  }

  // Suppress uncaught errors injected by browser extensions (e.g. Web Vitals / performance profilers)
  window.addEventListener('error', (event) => {
    if (event.message?.includes("reading 'startTime'") || event.message?.includes('reportAllChanges')) {
      event.preventDefault();
    }
  });
}

export const unstable_settings = {
  initialRouteName: '(tabs)',
};
initWebUpdateChecker();

// Held until the auth bootstrap (session + profile) and the onboarding-seen
// check both resolve, so the tabs-anchor screen is never mounted before we
// know the correct first screen to land on.
SplashScreen.preventAutoHideAsync().catch(() => {});

// â”€â”€ Offline Banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      <Text style={styles.offlineBannerText}>âš¡ No internet â€” browsing cached content</Text>
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

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  }, [segments]);

  // Latches to true the first time we confirm a fully authenticated + profiled
  // session. Never resets to false within a mount â€” protects against transient
  // null profile/session states from silent token refreshes kicking the user
  // out of the tabs they are actively navigating.
  const hasAuthenticated = useRef(false);

  // Checked once per cold start, not gated on routing: a pending request
  // shouldn't lock the user out of the app (see account-settings.tsx's own
  // "does not sign you out" copy), just surface once so it isn't silently
  // forgotten in the queue.
  // Update last_seen on load and when app comes to foreground
  // (Removed temporarily because it causes 400 Bad Request on web)

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

  // Latches to true once the destination route required by the authentication
  // state is confirmed mounted, removing the branded bootstrap loader.
  const [routeSettled, setRouteSettled] = useState(false);

  // Tracks the last replacement destination to prevent re-firing router.replace
  // across consecutive render passes before segments updates.
  const lastRedirectTargetRef = useRef<string | null>(null);

  // Development diagnostic to detect any stuck routing states.
  useEffect(() => {
    if (!__DEV__) return;
    const timer = setTimeout(() => {
      if (!routeSettled) {
        console.warn('[RootLayout] Routing has remained unsettled for over 10s.', {
          hasSession: !!session,
          flagsReady,
          segments,
        });
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [routeSettled, session, flagsReady, segments]);

  useEffect(() => {
    if (!session) {
      hasAuthenticated.current = false;
    }
    const pathSegments = segments as string[];
    const AUTH_SCREENS = ['(auth)', 'welcome', 'auth', 'onboarding', 'profile-setup', 'reset-password'];
    const inAuthGroup = pathSegments.some((s) => AUTH_SCREENS.includes(s));
    const onProfileSetup = pathSegments.includes('profile-setup');
    const onResetPassword = pathSegments.includes('reset-password');

    // Helper: Safely replace route without issuing duplicate navigations
    const safeRedirect = (target: string) => {
      if (lastRedirectTargetRef.current === target) return;
      lastRedirectTargetRef.current = target;
      router.replace(target as any);
    };

    // CRITICAL: Once authenticated and in the app tabs, ensure settled state is latched
    // and skip ALL re-evaluations during tab switches so the cold-boot overlay never flickers.
    if (session && profile?.first_name && !inAuthGroup && !isPasswordRecovery && !profile?.deleted) {
      hasAuthenticated.current = true;
      lastRedirectTargetRef.current = null;
      if (!routeSettled) setRouteSettled(true);
      return;
    }

    if (routeSettled && hasAuthenticated.current && !inAuthGroup && !isPasswordRecovery && !profile?.deleted) {
      return;
    }

    // 1. Password Recovery Mode
    if (isPasswordRecovery) {
      if (!onResetPassword) {
        safeRedirect('/(auth)/reset-password');
      } else {
        lastRedirectTargetRef.current = null;
        setRouteSettled(true);
      }
      return;
    }

    // 2. Profile Deletion
    if (profile?.deleted) {
      signOut();
      return;
    }

    // 3. For the initial bootstrap, wait until all async flags are resolved
    if (!flagsReady) return;

    // 4. Unauthenticated (Guests)
    if (!session) {
      if (!inAuthGroup) {
        const dest = onboardingSeen ? '/(auth)/welcome' : '/(auth)/onboarding';
        safeRedirect(dest);
      } else {
        // Destination observed: user is inside auth group
        lastRedirectTargetRef.current = null;
        setRouteSettled(true);
      }
      return;
    }

    // 5. Authenticated Users
    // 5a. Incomplete Profile: First name required before entering the app
    if (!profile || !profile.first_name) {
      if (!onProfileSetup) {
        safeRedirect('/(auth)/profile-setup');
      } else {
        // Destination observed: user is on profile-setup screen
        lastRedirectTargetRef.current = null;
        setRouteSettled(true);
      }
      return;
    }

    // 5b. Complete Profile: User must be in tabs navigator (outside auth)
    if (inAuthGroup) {
      safeRedirect('/(tabs)');
      return;
    }

    // Destination observed: user is confirmed in the app (outside auth)
    hasAuthenticated.current = true;
    lastRedirectTargetRef.current = null;
    setRouteSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagsReady, session, segments, profile, router, onboardingSeen, isPasswordRecovery, signOut, routeSettled]);

  useEffect(() => {
    if (hasBootstrapped) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasBootstrapped]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
      </Stack>
      {/* Branded loading overlay: covers the Stack during cold bootstrap until routeSettled is confirmed */}
      {!routeSettled && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.background,
              zIndex: 999,
              justifyContent: 'center',
              alignItems: 'center',
              pointerEvents: 'none',
            },
          ]}
        >
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
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
          <BottomSheetModalProvider>
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
          </BottomSheetModalProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default RootLayout;

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
