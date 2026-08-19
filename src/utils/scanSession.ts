import { randomUUID } from 'expo-crypto';

export type PendingScanSession = {
  measurements: unknown;
  height: number | null;
  weight: number | null;
  gender: string;
};

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map<string, { value: PendingScanSession; expiresAt: number }>();

function removeExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function createScanSession(value: PendingScanSession): string {
  removeExpiredSessions();
  const id = randomUUID();
  sessions.set(id, { value, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function consumeScanSession(id: string): PendingScanSession | null {
  removeExpiredSessions();
  const session = sessions.get(id);
  if (!session) return null;
  sessions.delete(id);
  return session.value;
}

export function clearScanSession(id: string): void {
  sessions.delete(id);
}
