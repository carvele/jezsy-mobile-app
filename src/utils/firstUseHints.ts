import AsyncStorage from '@react-native-async-storage/async-storage';

const HINTS_SEEN_KEY_PREFIX = '@jezsy_feature_hint:';

/**
 * Checks if a specific feature hint has been seen by the user.
 * Supports versioning through the featureId (e.g., 'ar_try_on:v2').
 * 
 * Note on unauthenticated behavior: If `userId` is missing, this returns `true`.
 * Unauthenticated users are ineligible for feature hints (and typically cannot access
 * these features anyway), so we suppress the modal by treating the hint as already seen.
 */
export async function hasSeenHint(userId: string | null | undefined, featureId: string): Promise<boolean> {
  if (!userId) return true;
  
  try {
    const key = `${HINTS_SEEN_KEY_PREFIX}${userId}:${featureId}`;
    const val = await AsyncStorage.getItem(key);
    return val === 'true';
  } catch (err) {
    console.error('Failed to read seen hint:', err);
    return false;
  }
}

/**
 * Marks a feature hint as seen for the specified user.
 */
export async function markHintSeen(userId: string | null | undefined, featureId: string): Promise<void> {
  if (!userId) return;
  
  try {
    const key = `${HINTS_SEEN_KEY_PREFIX}${userId}:${featureId}`;
    await AsyncStorage.setItem(key, 'true');
  } catch (err) {
    console.error('Failed to persist seen hint:', err);
  }
}

/**
 * Resets a feature hint so it can be seen again (useful for testing or re-learning).
 */
export async function resetHint(userId: string | null | undefined, featureId: string): Promise<void> {
  if (!userId) return;
  
  try {
    const key = `${HINTS_SEEN_KEY_PREFIX}${userId}:${featureId}`;
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.error('Failed to reset seen hint:', err);
  }
}
