import { AR_POSE_STALE_MS, ARTrackingSession } from '../arTrackingSession';
import type { LengthFitSignal } from '../sizeRecommender';

const length: LengthFitSignal = { verdict: 'appropriate', deltaCm: 0, chartLengthCm: 65, trackedTorsoLengthCm: 45 };

describe('AR tracking session', () => {
  let session: ARTrackingSession;
  beforeEach(() => {
    session = new ARTrackingSession();
    session.start(true);
  });

  it('starts searching, not active just because the detector initialized', () => {
    expect(session.snapshot).toEqual({ status: 'searching', lengthFit: null });
    session.record('TRACKING_LOST', null, 0);
    expect(session.snapshot.status).toBe('searching');
  });

  it('expires a silent stream using elapsed host time, even without an empty-pose callback', () => {
    session.record('GOOD_FIT', length, 0);
    expect(session.expire(AR_POSE_STALE_MS - 1)).toBe(false);
    expect(session.snapshot.lengthFit).toEqual(length);
    expect(session.expire(AR_POSE_STALE_MS)).toBe(true);
    expect(session.snapshot).toEqual({ status: 'lost', lengthFit: null });
    expect(session.expire(AR_POSE_STALE_MS + 100)).toBe(false);
  });

  it('refreshes the deadline on each valid pose', () => {
    session.record('GOOD_FIT', length, 0);
    session.record('GOOD_FIT', length, 500);
    expect(session.expire(AR_POSE_STALE_MS)).toBe(false);
    expect(session.expire(500 + AR_POSE_STALE_MS)).toBe(true);
  });

  it.each(['TRACKING_LOST', 'LOW_LIGHT', 'STEP_BACK', 'FULL_BODY_REQUIRED'] as const)(
    'clears the garment and estimate immediately on %s', (state) => {
      session.record('GOOD_FIT', length, 0);
      session.record(state, length, 50);
      expect(session.snapshot).toEqual({ status: 'lost', lengthFit: null });
    }
  );

  it('keeps turn guidance but withholds length, and expires a stopped turned pose', () => {
    session.record('TURN_TOO_FAR', length, 100);
    expect(session.snapshot).toEqual({ status: 'turned', lengthFit: null });
    session.expire(100 + AR_POSE_STALE_MS);
    expect(session.snapshot.status).toBe('lost');
  });

  it('discards the previous estimate when metric landmarks become unavailable', () => {
    session.record('GOOD_FIT', length, 100);
    session.record('GOOD_FIT', null, 150);
    expect(session.snapshot).toEqual({ status: 'tracking', lengthFit: null });
  });

  it('rejects late callbacks from a stopped session and starts clean on resume', () => {
    session.record('GOOD_FIT', length, 100);
    session.stop();
    expect(session.record('GOOD_FIT', length, 200)).toBe(false);
    expect(session.snapshot).toEqual({ status: 'paused', lengthFit: null });
    session.start(true);
    expect(session.snapshot).toEqual({ status: 'searching', lengthFit: null });
    session.record('GOOD_FIT', length, 300);
    expect(session.snapshot.status).toBe('tracking');
  });

  it('rejects non-finite arrival times', () => {
    expect(session.record('GOOD_FIT', length, NaN)).toBe(false);
    expect(session.record('GOOD_FIT', length, Infinity)).toBe(false);
    expect(session.snapshot.status).toBe('searching');
  });
});
