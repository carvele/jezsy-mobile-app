import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_SEEN_KEY = 'jezsy_onboarding_seen';

const listeners: ((seen: boolean) => void)[] = [];

export function onOnboardingSeenChanged(callback: (seen: boolean) => void) {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx > -1) listeners.splice(idx, 1);
  };
}

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
    listeners.forEach(cb => cb(true));
  } catch (err) {
    console.error('Failed to persist onboarding-seen flag:', err);
  }
}
