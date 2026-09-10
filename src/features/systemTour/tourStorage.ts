import AsyncStorage from '@react-native-async-storage/async-storage';
import { TourModuleId } from './tourConfig';

export interface TourModuleProgress {
  started: boolean;
  completed: boolean;
  /** Step ids completed so far, in whatever order the user actually did them - not assumed sequential. */
  completedStepIds: string[];
  version: number;
}

/** version: 0 means "never written" - distinct from a real stored version, so
 * a stale-version reconciliation (see tourProgress.ts) never mistakes a
 * fresh module for a downgrade. */
const DEFAULT_PROGRESS: TourModuleProgress = {
  started: false,
  completed: false,
  completedStepIds: [],
  version: 0,
};

export interface TourDismissal {
  /** Set by "Skip for now" - a soft dismissal; progress is kept and the tour may resurface later. */
  skippedAt: string | null;
  /** Set by "Don't show again" - a permanent opt-out of the guided onboarding experience. */
  neverShowAgain: boolean;
}

const DEFAULT_DISMISSAL: TourDismissal = { skippedAt: null, neverShowAgain: false };

const moduleKey = (userId: string, moduleId: TourModuleId) => `@jezsy_tour:${userId}:module:${moduleId}`;
const dismissalKey = (userId: string) => `@jezsy_tour:${userId}:dismissal`;

export async function readModuleProgress(userId: string, moduleId: TourModuleId): Promise<TourModuleProgress> {
  try {
    const raw = await AsyncStorage.getItem(moduleKey(userId, moduleId));
    if (!raw) return { ...DEFAULT_PROGRESS };
    return { ...DEFAULT_PROGRESS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to read tour module progress:', err);
    return { ...DEFAULT_PROGRESS };
  }
}

export async function writeModuleProgress(
  userId: string,
  moduleId: TourModuleId,
  progress: TourModuleProgress
): Promise<void> {
  try {
    await AsyncStorage.setItem(moduleKey(userId, moduleId), JSON.stringify(progress));
  } catch (err) {
    console.error('Failed to persist tour module progress:', err);
  }
}

export async function clearModuleProgress(userId: string, moduleId: TourModuleId): Promise<void> {
  try {
    await AsyncStorage.removeItem(moduleKey(userId, moduleId));
  } catch (err) {
    console.error('Failed to clear tour module progress:', err);
  }
}

export async function readDismissal(userId: string): Promise<TourDismissal> {
  try {
    const raw = await AsyncStorage.getItem(dismissalKey(userId));
    if (!raw) return { ...DEFAULT_DISMISSAL };
    return { ...DEFAULT_DISMISSAL, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to read tour dismissal state:', err);
    return { ...DEFAULT_DISMISSAL };
  }
}

export async function writeDismissal(userId: string, dismissal: TourDismissal): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissalKey(userId), JSON.stringify(dismissal));
  } catch (err) {
    console.error('Failed to persist tour dismissal state:', err);
  }
}

export async function clearDismissal(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(dismissalKey(userId));
  } catch (err) {
    console.error('Failed to clear tour dismissal state:', err);
  }
}
