import { randomUUID } from 'expo-crypto';

export type ReservationAttempt = {
  fingerprint: string;
  key: string;
};

export function getReservationAttempt(
  current: ReservationAttempt | null,
  payload: unknown,
): ReservationAttempt {
  const fingerprint = JSON.stringify(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, key: randomUUID() };
}
