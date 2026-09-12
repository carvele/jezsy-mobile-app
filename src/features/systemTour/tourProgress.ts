// Domain layer for the guided system tour. A component (SystemTourModal,
// TourCoachmark, TourProgressCard) should only ever call into these
// functions - it should not read/write AsyncStorage or reason about
// dismissal/version semantics itself.
//
// Eligibility contract (device-local, user-keyed progress):
//   - guest (no userId)              -> isSystemTourComplete resolves true;
//                                        the tour never surfaces.
//   - new authenticated user         -> no stored progress anywhere ->
//                                        hasTourBeenIntroduced() is false ->
//                                        Home auto-opens the full modal once.
//   - returning user, same device    -> resumes from stored progress/dismissal.
//   - user restored on a new device  -> AsyncStorage is device-local, so this
//                                        looks identical to "new authenticated
//                                        user" and the tour reintroduces
//                                        itself. This is intentional for now,
//                                        not a bug: progress is device-local
//                                        by design, not account-synced. If
//                                        that's ever wrong, the fix is
//                                        syncing dismissal/progress to the
//                                        Supabase profile - do not assume
//                                        AsyncStorage state is account-global
//                                        anywhere in this feature.
//   - user who chose "Don't show
//     again"                         -> isSystemTourComplete resolves true on
//                                        this device only.
//   - user replaying from Profile    -> SystemTourModal's isReplay=true skips
//                                        every write in this file; a replay
//                                        never touches historical progress or
//                                        dismissal state.

import { TOUR_MODULE_IDS, TOUR_MODULES, TourModuleId } from './tourConfig';
import {
  clearDismissal,
  clearModuleProgress,
  readDismissal,
  readModuleProgress,
  TourDismissal,
  TourModuleProgress,
  writeDismissal,
  writeModuleProgress,
} from './tourStorage';
import { reportTourAnalyticsEvent } from './tourAnalytics';

export type TourProgressSnapshot = Record<TourModuleId, TourModuleProgress>;

/**
 * Version reconciliation contract for one module's stored progress against
 * its current config version:
 *   - stored.version === config.version -> resume as-is.
 *   - stored.version === 0              -> never written; fresh module, not a
 *                                           downgrade. Resume as-is (it's
 *                                           already the default shape).
 *   - stored.version < config.version   -> stale. This codebase has no
 *                                           per-version migration functions
 *                                           yet, so the contract's fallback
 *                                           applies: restart that module only
 *                                           (persist a fresh default stamped
 *                                           with the current version). A
 *                                           future migration would slot in
 *                                           here instead of the reset.
 *   - stored.version > config.version   -> the device has progress from a
 *                                           newer build than this one
 *                                           understands (e.g. app rollback).
 *                                           Fail safe: never overwrite it.
 *                                           Treat the module as not-started
 *                                           for *this* session's display only.
 */
async function reconcileModuleProgress(userId: string, moduleId: TourModuleId): Promise<TourModuleProgress> {
  const configVersion = TOUR_MODULES[moduleId].version;
  const stored = await readModuleProgress(userId, moduleId);

  if (stored.version === configVersion || stored.version === 0) {
    return stored;
  }

  if (stored.version < configVersion) {
    const restarted: TourModuleProgress = {
      started: false,
      completed: false,
      completedStepIds: [],
      version: configVersion,
    };
    await writeModuleProgress(userId, moduleId, restarted);
    return restarted;
  }

  // stored.version > configVersion: fail safe, don't touch storage.
  return { started: false, completed: false, completedStepIds: [], version: stored.version };
}

export async function getTourProgress(userId: string): Promise<TourProgressSnapshot> {
  const entries = await Promise.all(
    TOUR_MODULE_IDS.map(async (id) => [id, await reconcileModuleProgress(userId, id)] as const)
  );
  return Object.fromEntries(entries) as TourProgressSnapshot;
}

/** True once every module is complete, or the user explicitly opted out via "Don't show again". */
export async function isSystemTourComplete(userId?: string | null): Promise<boolean> {
  if (!userId) return true;
  const dismissal = await readDismissal(userId);
  if (dismissal.neverShowAgain) return true;
  const progress = await getTourProgress(userId);
  return TOUR_MODULE_IDS.every((id) => progress[id].completed);
}

/** True when the user soft-dismissed the tour card (\"Skip for now\"). */
export async function isTourDismissed(userId: string): Promise<boolean> {
  const dismissal = await readDismissal(userId);
  return !!dismissal.skippedAt;
}

/** True once the tour has been surfaced at least once (started a module or was dismissed). */
export async function hasTourBeenIntroduced(userId: string): Promise<boolean> {
  const dismissal = await readDismissal(userId);
  if (dismissal.skippedAt || dismissal.neverShowAgain) return true;
  const progress = await getTourProgress(userId);
  return TOUR_MODULE_IDS.some((id) => progress[id].started);
}

/** The first step not yet completed, in config order - the recommended next step regardless of what order the user actually did earlier ones in. */
export function nextIncompleteStepIndex(moduleId: TourModuleId, progress: TourModuleProgress): number {
  const steps = TOUR_MODULES[moduleId].steps;
  return steps.findIndex((s) => !progress.completedStepIds.includes(s.id));
}

export async function markTourModuleStarted(userId: string, moduleId: TourModuleId): Promise<void> {
  const current = await reconcileModuleProgress(userId, moduleId);
  if (current.started) return;
  await writeModuleProgress(userId, moduleId, {
    ...current,
    started: true,
    version: TOUR_MODULES[moduleId].version,
  });
  reportTourAnalyticsEvent('tour_module_started', { moduleId, version: TOUR_MODULES[moduleId].version });
}

/**
 * Marks a specific step complete regardless of which step is "current" -
 * safe to call out of order (e.g. the user completed step 3's real-world
 * action before ever advancing past step 1's coachmark).
 */
export async function markTourStepComplete(userId: string, moduleId: TourModuleId, stepId: string): Promise<void> {
  const moduleDef = TOUR_MODULES[moduleId];
  if (!moduleDef.steps.some((s) => s.id === stepId)) return;
  const current = await reconcileModuleProgress(userId, moduleId);
  if (current.completedStepIds.includes(stepId)) return;

  const completedStepIds = [...current.completedStepIds, stepId];
  const completed = moduleDef.steps.every((s) => completedStepIds.includes(s.id));
  await writeModuleProgress(userId, moduleId, {
    started: true,
    completed,
    completedStepIds,
    version: moduleDef.version,
  });

  reportTourAnalyticsEvent('tour_step_completed', { moduleId, stepId, version: moduleDef.version });
  if (completed) {
    reportTourAnalyticsEvent('tour_module_completed', { moduleId, version: moduleDef.version });
    if (await isSystemTourComplete(userId)) {
      reportTourAnalyticsEvent('tour_completed', { version: moduleDef.version });
    }
  }
}

export async function markTourModuleComplete(userId: string, moduleId: TourModuleId): Promise<void> {
  const moduleDef = TOUR_MODULES[moduleId];
  await writeModuleProgress(userId, moduleId, {
    started: true,
    completed: true,
    completedStepIds: moduleDef.steps.map((s) => s.id),
    version: moduleDef.version,
  });
  reportTourAnalyticsEvent('tour_module_completed', { moduleId, version: moduleDef.version });
  if (await isSystemTourComplete(userId)) {
    reportTourAnalyticsEvent('tour_completed', { version: moduleDef.version });
  }
}

/** "Skip for now": dismiss the current presentation, keep progress, allow resurfacing later. */
export async function dismissSystemTour(userId: string): Promise<void> {
  const dismissal = await readDismissal(userId);
  await writeDismissal(userId, { ...dismissal, skippedAt: new Date().toISOString() });
  reportTourAnalyticsEvent('tour_skipped', { version: 0 });
}

/** "Don't show again": permanent opt-out of the guided onboarding experience. Does not touch module progress. */
export async function neverShowSystemTourAgain(userId: string): Promise<void> {
  await writeDismissal(userId, { skippedAt: new Date().toISOString(), neverShowAgain: true });
  reportTourAnalyticsEvent('tour_opted_out', { version: 0 });
}

/** Clears all module progress (started/completed/completedStepIds) for every module. Leaves dismissal state untouched. */
export async function resetTourProgress(userId: string): Promise<void> {
  await Promise.all(TOUR_MODULE_IDS.map((id) => clearModuleProgress(userId, id)));
}

/** Clears the soft "Skip for now" mark only. Leaves module progress and the permanent opt-out untouched. */
export async function resetTourDismissal(userId: string): Promise<void> {
  const dismissal = await readDismissal(userId);
  await writeDismissal(userId, { ...dismissal, skippedAt: null });
}

/** Clears the permanent "Don't show again" opt-out only. Leaves module progress and any soft dismissal untouched. */
export async function resetTourOptOut(userId: string): Promise<void> {
  const dismissal = await readDismissal(userId);
  await writeDismissal(userId, { ...dismissal, neverShowAgain: false });
}

/**
 * Full reset: progress + all dismissal state, so the tour behaves like a
 * first login again. A QA/testing utility, not something normal product
 * flows should call - Profile's replay uses isReplay=true instead, which
 * shows the hub without touching any stored state at all.
 */
export async function resetSystemTourEntirely(userId: string): Promise<void> {
  await resetTourProgress(userId);
  await clearDismissal(userId);
}

export type { TourDismissal, TourModuleProgress };
