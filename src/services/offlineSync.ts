/**
 * offlineSync.ts
 *
 * Manages three offline capabilities:
 *  1. Product catalog caching — browse products without internet.
 *  2. Offline outfit session persistence — save outfit combos locally.
 *  3. Order / reservation queueing — queue submissions and auto-flush
 *     to Supabase as soon as the network is restored.
 *
 * Architecture notes:
 *  - Uses AsyncStorage for persistence (already a peer dep).
 *  - Uses @react-native-community/netinfo for connectivity signals.
 *  - All keys are namespaced under @jezsy_offline/* to avoid collisions.
 *  - The queue is a simple FIFO list of serialised Supabase upsert payloads.
 *    Each entry carries enough data for the server to process idempotently
 *    (an `offline_id` UUID generated client-side guards against duplicates
 *    if the flush fires more than once before the server confirms).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { supabase } from '@/src/lib/supabase';

// ── Key constants ─────────────────────────────────────────────────────────────
const KEYS = {
  CATALOG_CACHE: '@jezsy_offline/catalog_cache',
  CATALOG_CACHE_AT: '@jezsy_offline/catalog_cache_at',
  OUTFIT_SESSION: '@jezsy_offline/outfit_session',
  ORDER_QUEUE: '@jezsy_offline/order_queue',
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

export type QueuedOrder = {
  /** Client-generated UUID — prevents duplicate inserts on re-flush. */
  offline_id: string;
  table: 'reservations' | 'reservation_items';
  payload: Record<string, unknown>;
  queued_at: string; // ISO-8601
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

// ── Order / Reservation Queue ─────────────────────────────────────────────────
/**
 * Appends an order payload to the local queue.
 * Call this whenever a checkout/reservation attempt fails due to no network.
 */
export async function enqueueOrder(
  table: QueuedOrder['table'],
  payload: Record<string, unknown>
): Promise<string> {
  const offline_id = generateUUID();
  const entry: QueuedOrder = {
    offline_id,
    table,
    payload: { ...payload, offline_id },
    queued_at: new Date().toISOString(),
  };
  try {
    const raw = await AsyncStorage.getItem(KEYS.ORDER_QUEUE);
    const queue: QueuedOrder[] = raw ? JSON.parse(raw) : [];
    queue.push(entry);
    await AsyncStorage.setItem(KEYS.ORDER_QUEUE, JSON.stringify(queue));
  } catch (err) {
    console.warn('[OfflineSync] Failed to enqueue order:', err);
  }
  return offline_id;
}

async function getQueue(): Promise<QueuedOrder[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ORDER_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.ORDER_QUEUE);
}

/**
 * Flushes all queued orders to Supabase.
 * Called automatically by the NetInfo listener when the device goes online,
 * but can also be called manually (e.g., on app foreground).
 *
 * Returns an array of offline_ids that were successfully flushed.
 */
export async function flushOrderQueue(): Promise<string[]> {
  const queue = await getQueue();
  if (queue.length === 0) return [];

  const flushed: string[] = [];
  const remaining: QueuedOrder[] = [];

  for (const entry of queue) {
    try {
      const { error } = await supabase
        .from(entry.table)
        .upsert(entry.payload as any, { onConflict: 'offline_id' });

      if (error) {
        console.warn(`[OfflineSync] Failed to flush ${entry.offline_id}:`, error.message);
        remaining.push(entry);
      } else {
        flushed.push(entry.offline_id);
      }
    } catch (err) {
      console.warn(`[OfflineSync] Exception flushing ${entry.offline_id}:`, err);
      remaining.push(entry);
    }
  }

  if (remaining.length === 0) {
    await clearQueue();
  } else {
    await AsyncStorage.setItem(KEYS.ORDER_QUEUE, JSON.stringify(remaining));
  }

  return flushed;
}

export async function getPendingQueueCount(): Promise<number> {
  return (await getQueue()).length;
}

// ── NetInfo Listener ──────────────────────────────────────────────────────────
let _unsubscribe: (() => void) | null = null;

/**
 * Register a global listener that auto-flushes the order queue whenever the
 * device reconnects to the internet. Call once from your app root (_layout.tsx).
 * Returns an unsubscribe function for cleanup.
 */
export function registerOfflineSyncListener(
  onFlush?: (flushedIds: string[]) => void
): () => void {
  if (_unsubscribe) _unsubscribe(); // prevent duplicate listeners

  _unsubscribe = NetInfo.addEventListener(async (state: NetInfoState) => {
    const isOnline = state.isConnected && state.isInternetReachable;
    if (isOnline) {
      const flushed = await flushOrderQueue();
      if (flushed.length > 0) {
        console.log(`[OfflineSync] Flushed ${flushed.length} queued order(s).`);
        onFlush?.(flushed);
      }
    }
  });

  return () => {
    _unsubscribe?.();
    _unsubscribe = null;
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────
/**
 * Minimal RFC-4122 v4 UUID generator that works without the `uuid` package.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Checks whether the device currently has internet access.
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!(state.isConnected && state.isInternetReachable);
}
