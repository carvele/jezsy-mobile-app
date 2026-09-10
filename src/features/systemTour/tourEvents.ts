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
