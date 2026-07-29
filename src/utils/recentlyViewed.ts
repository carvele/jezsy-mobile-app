import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@jezsy_recently_viewed';
const MAX_ENTRIES = 10;

export async function getRecentlyViewed(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function addRecentlyViewed(productId: string): Promise<void> {
  try {
    const current = await getRecentlyViewed();
    const next = [productId, ...current.filter(id => id !== productId)].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed write just means the strip misses this item; not worth surfacing.
  }
}
