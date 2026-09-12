// Minimal pub/sub so a screen far from the tour engine (e.g. the product
// detail screen) can report a real user action without importing the whole
// tour domain. Coachmark steps with completion.type 'interaction' or
// 'navigation' subscribe to these by event/route name.
//
// A subscriber that only starts listening after an async read (tour
// progress from AsyncStorage) can lose an event emitted synchronously on
// the target screen's mount - the classic "navigate -> screen emits ->
// listener mounts a tick later" race. Emits are buffered briefly so a
// subscriber that attaches shortly after still catches it.

import { TOUR_MODULES, TourModuleId } from './tourConfig';

type Listener = () => void;

const BUFFER_WINDOW_MS = 5000;

const listeners = new Map<string, Set<Listener>>();
const recentEmits = new Map<string, number>();

export function emitTourEvent(name: string): void {
  recentEmits.set(name, Date.now());
  listeners.get(name)?.forEach((fn) => fn());
}

export function subscribeTourEvent(name: string, fn: Listener): () => void {
  const emittedAt = recentEmits.get(name);
  if (emittedAt !== undefined && Date.now() - emittedAt <= BUFFER_WINDOW_MS) {
    recentEmits.delete(name);
    fn();
  }
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => {
    listeners.get(name)?.delete(fn);
  };
}

// Ephemeral, in-memory-only "replay session": Profile's Replay Tour
// (SystemTourModal isReplay=true) deliberately never writes to stored
// progress (see tourProgress.ts's eligibility contract - a replay must
// never touch a user's real completion history). But useTourCoachmark's
// on-screen banner only ever reads stored progress, so before this existed
// a replay's own promise ("we'll show quick tips right on the screen as
// you go") never actually happened. This session lets useTourCoachmark
// show a module's real steps during a replay, tracked only here in memory,
// never persisted. A plain module-level object rather than a
// listener-based signal: the only writers are SystemTourModal (starting a
// session) and a screen's own useTourCoachmark (completing one of its
// steps), and both already call refresh() themselves right after, so nothing
// needs to be notified out of band.
interface TourReplaySession {
  moduleId: TourModuleId;
  completedStepIds: Set<string>;
}

let replaySession: TourReplaySession | null = null;

export function startTourReplay(moduleId: TourModuleId): void {
  replaySession = { moduleId, completedStepIds: new Set() };
}

export function getActiveTourReplay(): TourReplaySession | null {
  return replaySession;
}

/** Marks one step done for the active replay session. No-ops if that session isn't for this module (e.g. it already ended). Clears itself once every step in the module is done. */
export function completeTourReplayStep(moduleId: TourModuleId, stepId: string): void {
  if (!replaySession || replaySession.moduleId !== moduleId) return;
  replaySession.completedStepIds.add(stepId);
  if (TOUR_MODULES[moduleId].steps.every((s) => replaySession!.completedStepIds.has(s.id))) {
    replaySession = null;
  }
}

/** Ends the active replay session outright, e.g. the user dismissed its coachmark instead of finishing it. */
export function clearTourReplay(): void {
  replaySession = null;
}
