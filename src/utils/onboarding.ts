import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_SEEN_KEY = 'jezsy_onboarding_seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
  } catch (err) {
    console.error('Failed to persist onboarding-seen flag:', err);
  }
}
