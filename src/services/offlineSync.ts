/**
 * offlineSync.ts
 *
 * Manages three offline capabilities:
 *  1. Product catalog caching — browse products without internet.
 *  2. Offline outfit session persistence — save outfit combos locally.
 *  3. Reservation submission is intentionally online-only. Reservation
 *     writes must go through the server RPC so price, stock, and availability
 *     are revalidated at commit time.
 *
 * Architecture notes:
 *  - Uses AsyncStorage for persistence (already a peer dep).
 *  - Uses @react-native-community/netinfo for connectivity signals.
 *  - All keys are namespaced under @jezsy_offline/* to avoid collisions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// ── Key constants ─────────────────────────────────────────────────────────────
const KEYS = {
  CATALOG_CACHE: '@jezsy_offline/catalog_cache',
  CATALOG_CACHE_AT: '@jezsy_offline/catalog_cache_at',
  OUTFIT_SESSION: '@jezsy_offline/outfit_session',
} as const;

// Product catalog cache TTL: 1 hour (products rarely change per session).
const CATALOG_TTL_MS = 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────────
export type OfflineProduct = {
  id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  image_url: string | null;
  category: string | null;
  stock: number | null;
  [key: string]: unknown;
};

// ── Product Catalog Cache ──────────────────────────────────────────────────────
/**
 * Writes a product list snapshot to AsyncStorage with a timestamp.
 */
export async function cacheProductCatalog(products: OfflineProduct[]): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEYS.CATALOG_CACHE, JSON.stringify(products)],
      [KEYS.CATALOG_CACHE_AT, Date.now().toString()],
    ]);
  } catch (err) {
    console.warn('[OfflineSync] Failed to cache catalog:', err);
  }
}

/**
 * Reads the cached catalog.
 * Returns null if the cache is absent or has expired.
 */
export async function getCachedCatalog(): Promise<OfflineProduct[] | null> {
  try {
    const [[, raw], [, cachedAtStr]] = await AsyncStorage.multiGet([
      KEYS.CATALOG_CACHE,
      KEYS.CATALOG_CACHE_AT,
    ]);
    if (!raw || !cachedAtStr) return null;
    const age = Date.now() - parseInt(cachedAtStr, 10);
    if (age > CATALOG_TTL_MS) return null; // stale
    return JSON.parse(raw) as OfflineProduct[];
  } catch {
    return null;
  }
}

// ── Offline Outfit Session ────────────────────────────────────────────────────
/**
 * Persists the current outfit builder slot state so it survives app restarts
 * even without internet (the outfit builder already uses in-memory state only).
 */
export async function saveOfflineOutfit(slots: Record<string, unknown>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.OUTFIT_SESSION, JSON.stringify(slots));
  } catch (err) {
    console.warn('[OfflineSync] Failed to save outfit session:', err);
  }
}

export async function getOfflineOutfit(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.OUTFIT_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearOfflineOutfit(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.OUTFIT_SESSION);
}

// The old order-queue listener is retained as a no-op compatibility hook for
// the root layout. It must not flush arbitrary payloads into booking tables.
export function registerOfflineSyncListener(): () => void {
  return () => {};
}

/**
 * Checks whether the device currently has internet access.
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!(state.isConnected && state.isInternetReachable);
}
