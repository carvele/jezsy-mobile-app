import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@jezsy_recently_viewed';
const MAX_ENTRIES = 10;

// Keyed by user id (or 'guest' when signed out) -- a bare device-wide key
// meant a brand-new account inherited whatever the previous signed-in user,
// or a guest session, had browsed on the same device.
function storageKey(userId?: string | null): string {
  return `${STORAGE_KEY}:${userId || 'guest'}`;
}

export async function getRecentlyViewed(userId?: string | null): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(storageKey(userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function addRecentlyViewed(productId: string, userId?: string | null): Promise<void> {
  try {
    const current = await getRecentlyViewed(userId);
    const next = [productId, ...current.filter(id => id !== productId)].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // A failed write just means the strip misses this item; not worth surfacing.
  }
}
