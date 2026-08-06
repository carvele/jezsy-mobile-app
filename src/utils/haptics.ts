/**
 * Tactile feedback for actions that change state.
 *
 * expo-haptics was already a dependency but no screen called it, so every
 * interaction landed silently -- one of the clearest tells between a native
 * app and a wrapped web page. These wrappers never throw: haptics are a
 * nicety, and a device without a taptic engine (or a simulator) must not
 * break the action it was decorating.
 */

import { Platform } from 'react-native';

type HapticsModule = typeof import('expo-haptics');

let cached: HapticsModule | null | undefined;

// Lazily required so a build without the native module still runs, matching
// the pattern used for push notifications.
function load(): HapticsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load so a build without the native module still runs
    cached = require('expo-haptics') as HapticsModule;
  } catch {
    cached = null;
  }
  return cached;
}

function run(fn: (h: HapticsModule) => void) {
  // Web has no haptics API; calling through would throw on every press.
  if (Platform.OS === 'web') return;
  const h = load();
  if (!h) return;
  try {
    fn(h);
  } catch {
    // Ignore -- feedback is decorative.
  }
}

/** A light tap. Selections, toggles, filter chips, tab changes. */
export function tapLight() {
  run((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
}

/** A firmer tap. Primary buttons: add to bag, reserve, save. */
export function tapMedium() {
  run((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium));
}

/** Confirms something worked. Pair with a success toast, not instead of one. */
export function notifySuccess() {
  run((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
}

/** Signals a failed or rejected action. */
export function notifyError() {
  run((h) => h.notificationAsync(h.NotificationFeedbackType.Error));
}

/** Warns before a destructive or irreversible step. */
export function notifyWarning() {
  run((h) => h.notificationAsync(h.NotificationFeedbackType.Warning));
}
