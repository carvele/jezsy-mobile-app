import AsyncStorage from '@react-native-async-storage/async-storage';

const SYSTEM_TOUR_KEY_PREFIX = '@jezsy_system_tour_seen:';

/**
 * Checks if the given user has completed or dismissed the system tour.
 */
export async function hasSeenSystemTour(userId?: string | null): Promise<boolean> {
  if (!userId) return true; // Don't trigger if unauthenticated
  try {
    const val = await AsyncStorage.getItem(`${SYSTEM_TOUR_KEY_PREFIX}${userId}`);
    return val === 'true';
  } catch (err) {
    console.error('Failed to read system tour flag:', err);
    return true;
  }
}

/**
 * Marks the system tour as seen for the specified user.
 */
export async function markSystemTourSeen(userId?: string | null): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(`${SYSTEM_TOUR_KEY_PREFIX}${userId}`, 'true');
  } catch (err) {
    console.error('Failed to persist system tour flag:', err);
  }
}

/**
 * Resets the system tour seen status so the user can replay it.
 */
export async function resetSystemTour(userId?: string | null): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(`${SYSTEM_TOUR_KEY_PREFIX}${userId}`);
  } catch (err) {
    console.error('Failed to reset system tour flag:', err);
  }
}
