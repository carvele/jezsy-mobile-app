import Constants from "expo-constants";
import { Platform } from "react-native";

// Detect if running inside Expo Go -- native crash capture needs the actual
// linked native module, same reasoning as pushNotifications.ts.
const IS_EXPO_GO = Constants.appOwnership === "expo";

let sentryModule: any = null;

/**
 * Call once, as early as possible (module scope in app/_layout.tsx, not
 * inside a component). Never throws: this runs before anything else in the
 * app, and an uncaught init failure here must not be able to block startup.
 * No-ops silently if EXPO_PUBLIC_SENTRY_DSN isn't set, so local dev and any
 * build missing the secret keep working exactly as before.
 */
export function initSentry(): void {
  if (IS_EXPO_GO && Platform.OS !== "web") return;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log("Sentry DSN not configured; error reporting disabled.");
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be synchronous, called once at startup before anything else
    sentryModule = require("@sentry/react-native");
    sentryModule.init({
      dsn,
      debug: __DEV__,
      // Session tracking (crash-free-session rate) is cheap and always on.
      // Trace sampling stays modest -- this is an internal-scale app, not a
      // high-traffic service where 100% tracing would be a real cost.
      enableAutoSessionTracking: true,
      tracesSampleRate: 0.2,
    });
  } catch (e) {
    console.error("Sentry init failed (non-fatal):", e);
    sentryModule = null;
  }
}

/**
 * Wraps the root component export (Sentry.wrap) for automatic touch-event
 * breadcrumbs and native crash linkage. Returns the component unchanged if
 * Sentry never initialized -- same fallback shape as initSentry itself.
 */
export function wrapRootComponent<T>(component: T): T {
  if (!sentryModule) return component;
  try {
    return sentryModule.wrap(component);
  } catch (e) {
    console.error("Sentry.wrap failed (non-fatal):", e);
    return component;
  }
}
