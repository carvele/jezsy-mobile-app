import { useCallback, useEffect, useMemo, useState } from 'react';
import { ARTrackingSession, type ARTrackingSnapshot } from '../utils/arTrackingSession';
import type { LengthFitSignal } from '../utils/sizeRecommender';
import type { TrackingState } from '../utils/trackingState';

export function useARTrackingSession(enabled: boolean, sessionKey: string) {
  const { session } = useMemo(() => ({ session: new ARTrackingSession(), enabled, sessionKey }), [enabled, sessionKey]);
  const [published, setPublished] = useState<{ session: ARTrackingSession; snapshot: ARTrackingSnapshot } | null>(null);
  const publisher = useMemo(() => ({ lastAt: -Infinity, status: session.snapshot.status, hasLength: false }), [session]);

  useEffect(() => {
    session.start(enabled);
    setPublished({ session, snapshot: session.snapshot });
    if (!enabled) return () => session.stop();
    const timer = setInterval(() => {
      if (session.expire(performance.now())) {
        setPublished({ session, snapshot: session.snapshot });
        publisher.status = session.snapshot.status;
      }
    }, 100);
    return () => {
      session.stop();
      clearInterval(timer);
    };
  }, [enabled, session, publisher]);

  const report = useCallback((state: TrackingState, lengthFit: LengthFitSignal | null = null) => {
    const now = performance.now();
    if (!session.record(state, lengthFit, now)) return false;
    const snapshot = session.snapshot;
    // Publish state and confidence changes immediately, but numeric length estimates at most four times per second.
    if (snapshot.status !== publisher.status || !!snapshot.lengthFit !== publisher.hasLength || now - publisher.lastAt >= 250) {
      publisher.lastAt = now;
      publisher.status = snapshot.status;
      publisher.hasLength = !!snapshot.lengthFit;
      setPublished({ session, snapshot });
    }
    return true;
  }, [session, publisher]);
  const isActive = useCallback(() => session.isActive(), [session]);

  // A product, size, camera, or lifecycle change must never display the previous session's result.
  const snapshot: ARTrackingSnapshot = published?.session === session ? published.snapshot
    : { status: enabled ? 'searching' : 'paused', lengthFit: null };
  return { ...snapshot, report, isActive };
}
