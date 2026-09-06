import type { LengthFitSignal } from './sizeRecommender';
import type { TrackingState } from './trackingState';

export const AR_POSE_STALE_MS = 750;
export type ARTrackingStatus = 'searching' | 'tracking' | 'turned' | 'lost' | 'paused';
export interface ARTrackingSnapshot {
  status: ARTrackingStatus;
  lengthFit: LengthFitSignal | null;
}

export const AR_TRACKING_GUIDANCE: Record<ARTrackingStatus, string> = {
  searching: 'Finding your body. Keep shoulders and hips in view.',
  tracking: 'Body tracking active',
  turned: 'Turn toward the camera for a clearer preview.',
  lost: 'Tracking lost. Face the camera with shoulders and hips visible.',
  paused: 'Camera paused',
};

export class ARTrackingSession {
  snapshot: ARTrackingSnapshot = { status: 'paused', lengthFit: null };
  private enabled = false;
  private lastValidAt: number | null = null;

  start(enabled: boolean) {
    this.enabled = enabled;
    this.lastValidAt = null;
    this.snapshot = { status: enabled ? 'searching' : 'paused', lengthFit: null };
  }

  stop() {
    this.start(false);
  }

  isActive(): boolean {
    return this.enabled;
  }

  record(state: TrackingState, lengthFit: LengthFitSignal | null, now: number): boolean {
    if (!this.enabled || !Number.isFinite(now)) return false;
    const tracked = state === 'GOOD_FIT' || state === 'TURN_TOO_FAR';
    if (tracked) this.lastValidAt = now;
    this.snapshot = {
      status: tracked ? (state === 'GOOD_FIT' ? 'tracking' : 'turned')
        : this.lastValidAt === null ? 'searching' : 'lost',
      lengthFit: state === 'GOOD_FIT' ? lengthFit : null,
    };
    return true;
  }

  expire(now: number): boolean {
    if (!this.enabled || this.lastValidAt === null || now - this.lastValidAt < AR_POSE_STALE_MS) return false;
    if (this.snapshot.status === 'lost') return false;
    this.snapshot = { status: 'lost', lengthFit: null };
    return true;
  }
}
