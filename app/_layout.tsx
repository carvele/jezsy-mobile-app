import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { NotificationProvider } from '@/src/context/NotificationContext';
import { ToastProvider } from '@/src/context/ToastContext';
import { AppThemeProvider, useThemeContext } from '@/src/context/ThemeContext';
import { handleRecoveryUrl } from '@/src/utils/recoveryLink';
import { hasSeenOnboarding, onOnboardingSeenChanged } from '@/src/utils/onboarding';
import { getPendingDeletionRequest } from '@/src/utils/accountDeletion';
import { PendingDeletionNoticeModal } from '@/src/components/PendingDeletionNoticeModal';
import { initWebUpdateChecker } from '@/src/utils/webUpdateChecker';
import { setupNotificationResponseHandler } from '@/src/utils/pushNotifications';
import NetInfo from '@react-native-community/netinfo';
import {
  savePendingEntryTarget,
  consumePendingEntryTarget,
  consumeAuthReturnTarget,
} from '@/src/utils/authReturnTarget';
import { appVersionService, VersionCheckResult } from '@/src/services/appVersionService';
import { MandatoryUpdateScreen } from '@/src/components/MandatoryUpdateScreen';
import { legalService, LegalAcceptanceStatus } from '@/src/services/legalService';
import { LegalAcceptanceGate } from '@/src/components/LegalAcceptanceGate';

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
  // Benign Expo Router timing quirk: the auth-redirect effect's router.replace()
  // can fire on the first render tick, before ContextNavigator finishes mounting.
  // Navigation still succeeds; this is framework-internal noise, not an app bug.
  "Can't perform a React state update on a component that hasn't mounted yet.",
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
      <Text style={styles.offlineBannerText}>⚡ No internet — browsing cached content</Text>
    </Animated.View>
  );
}

function InitialLayout() {
  const { session, isLoading, isProfileLoading, isProfileInitialized, profile, isPasswordRecovery, beginPasswordRecovery, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const themeLoaded = useThemeContext()?.loaded ?? false;

  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  // App version compliance state
  const [versionResult, setVersionResult] = useState<VersionCheckResult | null>(null);
  const [versionReady, setVersionReady] = useState(false);

  useEffect(() => {
    appVersionService.init();
    const unsub = appVersionService.subscribe((res) => {
      setVersionResult(res);
      setVersionReady(true);
    });
    appVersionService.checkVersionCompliance();
    return unsub;
  }, []);

  // Legal acceptance gate state
  const [legalStatus, setLegalStatus] = useState<LegalAcceptanceStatus | null>(null);
  const [legalError, setLegalError] = useState<Error | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalReady, setLegalReady] = useState(false);

  const checkLegalStatus = useCallback(async () => {
    if (!session?.user?.id) {
      setLegalStatus(null);
      setLegalError(null);
      setLegalLoading(false);
      setLegalReady(true);
      return;
    }
    setLegalLoading(true);
    setLegalError(null);
    try {
      const res = await legalService.getLegalAcceptanceStatus();
      setLegalStatus(res);
    } catch (err: any) {
      console.error('[RootLayout] Legal acceptance status check failed:', err);
      setLegalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLegalLoading(false);
      setLegalReady(true);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (session?.user?.id) {
      checkLegalStatus();
    } else {
      setLegalStatus(null);
      setLegalError(null);
      setLegalLoading(false);
      setLegalReady(true);
    }
  }, [session?.user?.id, checkLegalStatus]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  }, [segments]);

  // Latches to true the first time we confirm a fully authenticated + profiled
  // session. Never resets to false within a mount — protects against transient
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

  // Handle password-recovery and external public deep links (cold start and background taps)
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      if (await handleRecoveryUrl(url)) {
        beginPasswordRecovery();
        router.replace('/(auth)/reset-password' as any);
        return;
      }
      try {
        const parsed = Linking.parse(url);
        if (parsed.path) {
          const saved = await savePendingEntryTarget(parsed.path, parsed.queryParams ?? undefined);
          if (saved) {
            const seen = await hasSeenOnboarding();
            if (seen) {
              const target = await consumePendingEntryTarget();
              if (target) {
                router.push({
                  pathname: target.pathname,
                  params: target.params,
                } as any);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[RootLayout] Error processing deep link:', err);
      }
    };

    Linking.getInitialURL().then(handleUrl);

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, [router, beginPasswordRecovery]);

  // Handle push notification responses (background taps and cold start launch)
  useEffect(() => {
    return setupNotificationResponseHandler(router);
  }, [router]);

  useEffect(() => {
    hasSeenOnboarding().then(setOnboardingSeen);
    return onOnboardingSeenChanged((seen) => setOnboardingSeen(seen));
  }, []);

  // Gates the redirect effect on every run (same as before, so a later
  // refreshProfile() call still pauses redirects while it's in flight).
  // If there is an active session, profile MUST be initialized before routing can proceed.
  const profileReady = !session || isProfileInitialized;
  const isHardBlocked = versionResult?.status === 'HARD_BLOCK';
  const legalReadyForSession = !session || (legalReady && !legalLoading);
  const flagsReady = !isLoading && !isProfileLoading && profileReady && onboardingSeen !== null && themeLoaded && versionReady && legalReadyForSession;

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
    // PayMongo's redirect target on web -- it must render with no session,
    // since a customer's tab can lose one between opening checkout and
    // finishing payment (expired token, cleared storage, private window).
    if (pathSegments.includes('payment') && pathSegments.includes('return')) {
      lastRedirectTargetRef.current = null;
      if (!routeSettled) setRouteSettled(true);
      return;
    }

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

    if (hasAuthenticated.current && !inAuthGroup && !isPasswordRecovery && !profile?.deleted) {
      lastRedirectTargetRef.current = null;
      if (!routeSettled) setRouteSettled(true);
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

    // 4. Unauthenticated (Storefront-First Guest Browsing)
    if (!session) {
      if (!onboardingSeen) {
        if (!pathSegments.includes('onboarding')) {
          safeRedirect('/(auth)/onboarding');
        } else {
          lastRedirectTargetRef.current = null;
          setRouteSettled(true);
        }
        return;
      }

      // Guest has seen onboarding: allowed to browse storefront tabs or public screens
      if (inAuthGroup) {
        // User intentionally navigated into an auth screen (e.g. Welcome, Auth, Reset Password)
        lastRedirectTargetRef.current = null;
        setRouteSettled(true);
      } else {
        // User is browsing tabs or public screens
        lastRedirectTargetRef.current = null;
        setRouteSettled(true);
      }
      return;
    }

    // 5. Authenticated Users
    // 5a. Incomplete Profile: First name required before entering the app.
    // Only route to profile-setup if profile resolution is complete, first_name is missing,
    // and the user has not already been established inside the authenticated app.
    if (!profile?.first_name && !hasAuthenticated.current) {
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
      (async () => {
        const returnTarget = await consumeAuthReturnTarget();
        if (returnTarget) {
          lastRedirectTargetRef.current = null;
          router.replace({
            pathname: returnTarget.pathname,
            params: returnTarget.params,
          } as any);
          return;
        }
        const pendingEntry = await consumePendingEntryTarget();
        if (pendingEntry) {
          lastRedirectTargetRef.current = null;
          router.replace({
            pathname: pendingEntry.pathname,
            params: pendingEntry.params,
          } as any);
          return;
        }
        safeRedirect('/(tabs)');
      })();
      return;
    }

    // Destination observed: user is confirmed in the app (outside auth)
    hasAuthenticated.current = true;
    lastRedirectTargetRef.current = null;
    setRouteSettled(true);
  }, [flagsReady, session, segments, profile, router, onboardingSeen, isPasswordRecovery, signOut, routeSettled]);

  useEffect(() => {
    if (hasBootstrapped || isHardBlocked) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasBootstrapped, isHardBlocked]);

  // Safety fallback: ensure native splash screen and cold-boot overlay are never stuck permanently
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
      setHasBootstrapped(true);
      setRouteSettled(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (isHardBlocked) {
    return (
      <MandatoryUpdateScreen
        policy={versionResult?.policy ?? null}
        clientVersion={versionResult?.client.version ?? '1.0.0'}
        onRetry={async () => {
          await appVersionService.checkVersionCompliance();
        }}
      />
    );
  }

  const pathSegments = segments as string[];
  const isLegalBlocked = Boolean(
    session && (legalError || (legalStatus?.gate_enabled && !legalStatus?.can_continue))
  );
  const isSupportRoute = pathSegments.includes('messages');

  if (isLegalBlocked && !isSupportRoute) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <LegalAcceptanceGate
          status={legalStatus}
          error={legalError}
          onRetry={checkLegalStatus}
          onAccepted={() => {
            setLegalStatus((prev) => (prev ? { ...prev, can_continue: true } : null));
            setLegalError(null);
          }}
        />
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="legal/terms" />
        <Stack.Screen name="legal/privacy" />
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
                      <NotificationProvider>
                        <InitialLayout />
                      </NotificationProvider>
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
