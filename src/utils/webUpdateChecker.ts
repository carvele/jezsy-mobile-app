import { Platform } from 'react-native';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
let initialBuildTime: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Initializes background version checking on Web so users never get stuck
 * on stale JS bundles after a new production deployment.
 */
export function initWebUpdateChecker() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  // Fetch initial version once on boot
  fetchVersion().then((version) => {
    if (version?.buildTime) {
      initialBuildTime = version.buildTime;
      console.log(`[Version] Client running build: ${initialBuildTime}`);
    }
  });

  // Check periodically
  if (!intervalId) {
    intervalId = setInterval(() => {
      checkForUpdates();
    }, CHECK_INTERVAL_MS);
  }

  // Also check when tab becomes active again
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    });
  }
}

async function fetchVersion(): Promise<{ buildTime?: string } | null> {
  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

async function checkForUpdates() {
  const version = await fetchVersion();
  if (!version?.buildTime) return;

  if (initialBuildTime && version.buildTime !== initialBuildTime) {
    console.log(`[Version] New build detected on server: ${version.buildTime} (running: ${initialBuildTime})`);
    // Store latest detected build time
    initialBuildTime = version.buildTime;
  }
}
