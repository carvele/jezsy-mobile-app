import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@jezsy_category_affinity';

// Tap counts keyed by category name, kept on the device. Deliberately not a
// table: "most visited by this user" is per-device by nature, and a server
// round trip (plus a schema change and an RLS policy) buys nothing here.
export type CategoryAffinity = Record<string, number>;

export async function getCategoryAffinity(): Promise<CategoryAffinity> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export async function recordCategoryVisit(categoryName: string): Promise<void> {
  try {
    const current = await getCategoryAffinity();
    current[categoryName] = (current[categoryName] ?? 0) + 1;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // A failed write only costs this tap's weighting; not worth surfacing.
  }
}

// Visited categories first, most-tapped leading; everything else keeps the
// staff-controlled sort_order behind them. Sorting only the visited head means
// a new install still sees the merchandised order rather than an arbitrary one.
export function sortByAffinity<T extends { name: string }>(
  categories: T[],
  affinity: CategoryAffinity,
): T[] {
  return [...categories].sort((a, b) => (affinity[b.name] ?? 0) - (affinity[a.name] ?? 0));
}
