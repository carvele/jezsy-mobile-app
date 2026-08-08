import AsyncStorage from '@react-native-async-storage/async-storage';

const HINTS_SEEN_KEY = '@jezsy_seen_hints';

/**
 * One AsyncStorage key holding every seen hint id, not one key per hint --
 * matches the empty-state-hints pattern (contextual, shown once at the
 * moment a feature is first reached) rather than a scripted upfront tour.
 * See docs/onboarding decision: NN/g "just-in-time over just-in-case"
 * learning is the reason this is per-feature and reactive, not a sequenced
 * walkthrough.
 */
async function getSeenHints(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(HINTS_SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function hasSeenHint(id: string): Promise<boolean> {
  return (await getSeenHints()).includes(id);
}

export async function markHintSeen(id: string): Promise<void> {
  try {
    const seen = await getSeenHints();
    if (!seen.includes(id)) {
      await AsyncStorage.setItem(HINTS_SEEN_KEY, JSON.stringify([...seen, id]));
    }
  } catch (err) {
    console.error('Failed to persist seen hint:', err);
  }
}
