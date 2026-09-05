import {
  shouldCorrectNativeLandmarkRotation,
  correctWorldLandmarkRotation,
  correctNormalized2DLandmarkRotation,
  applyNativePoseCompatibility,
  MIN_VERTICAL_SEPARATION,
  type CompatLandmark,
} from '../nativePoseCompatibility';

/**
 * The guard is the only safety net for a real native-library defect, and its
 * behaviour on hardware without that defect is unverified on a physical device
 * (roadmap Step H, blocked on a second device). These tests are the deterministic
 * substitute: they pin both directions -- it MUST fire on the rotated signature,
 * and it MUST NOT fire on legitimate poses that superficially resemble it.
 */
function frame(pairs: Record<number, { x: number; y: number }>): CompatLandmark[] {
  const out: CompatLandmark[] = Array(33)
    .fill(null)
    .map(() => ({ x: 0, y: 0, z: 0 }));
  for (const [i, v] of Object.entries(pairs)) out[Number(i)] = { ...v, z: 0 };
  return out;
}

describe('nativePoseCompatibility: the guard fires on the rotated signature', () => {
  it('fires when the shoulder line reads vertical (tiny dx, large dy)', () => {
    // The exact signature captured live on the Infinix X6880: shoulders stacked
    // vertically instead of side by side.
    const f = frame({ 11: { x: 0.38, y: 0.84 }, 12: { x: 0.39, y: 0.21 } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(true);
  });

  it('fires regardless of which shoulder is higher', () => {
    const f = frame({ 11: { x: 0.39, y: 0.21 }, 12: { x: 0.38, y: 0.84 } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(true);
  });
});

describe('nativePoseCompatibility: the guard leaves legitimate poses alone', () => {
  it('does not fire for a normal frontal shoulder line', () => {
    // A device without the bug: shoulders side by side, wider than they are tall.
    const f = frame({ 11: { x: 0.62, y: 0.44 }, 12: { x: 0.30, y: 0.45 } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(false);
  });

  it('does not fire for a near-profile turn, where dx legitimately shrinks', () => {
    // Turned far enough that horizontal separation collapses, but the shoulders
    // stay roughly level -- dy is small, so this must not be mistaken for the bug.
    const f = frame({ 11: { x: 0.50, y: 0.44 }, 12: { x: 0.47, y: 0.46 } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(false);
  });

  it('does not fire for a strong sideways lean that keeps dx dominant', () => {
    // One shoulder clearly dropped, but still wider than tall: a real roll, not
    // a rotated frame.
    const f = frame({ 11: { x: 0.62, y: 0.36 }, 12: { x: 0.30, y: 0.52 } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(false);
  });

  it('does not fire when vertical separation is below the noise floor', () => {
    // dy dominates dx by more than the factor, but is too small to be real --
    // this is the case MIN_VERTICAL_SEPARATION exists to reject.
    const dy = MIN_VERTICAL_SEPARATION / 2;
    const f = frame({ 11: { x: 0.500, y: 0.40 }, 12: { x: 0.501, y: 0.40 + dy } });
    expect(shouldCorrectNativeLandmarkRotation(f)).toBe(false);
  });

  it('does not fire on missing or absent shoulder landmarks', () => {
    expect(shouldCorrectNativeLandmarkRotation(null)).toBe(false);
    expect(shouldCorrectNativeLandmarkRotation(undefined)).toBe(false);
    expect(shouldCorrectNativeLandmarkRotation([])).toBe(false);
  });
});

describe('nativePoseCompatibility: the rotations themselves', () => {
  it('rotates world landmarks about the origin: (x,y) -> (y,-x)', () => {
    const out = correctWorldLandmarkRotation({ x: 0.2, y: -0.4, z: 0.1 });
    expect(out.x).toBeCloseTo(-0.4);
    expect(out.y).toBeCloseTo(-0.2);
    expect(out.z).toBeCloseTo(0.1); // depth untouched
  });

  it('rotates normalized landmarks about the image centre: (x,y) -> (y,1-x)', () => {
    const out = correctNormalized2DLandmarkRotation({ x: 0.25, y: 0.75 });
    expect(out.x).toBeCloseTo(0.75);
    expect(out.y).toBeCloseTo(0.75);
  });

  it('keeps a normalized landmark inside [0,1]', () => {
    // The whole point of rotating about the centre rather than the origin.
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.9, y: 0.1 }]) {
      const out = correctNormalized2DLandmarkRotation(p);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.x).toBeLessThanOrEqual(1);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeLessThanOrEqual(1);
    }
  });

  it('preserves other landmark fields such as visibility', () => {
    const out = correctNormalized2DLandmarkRotation({ x: 0.2, y: 0.6, visibility: 0.97 });
    expect(out.visibility).toBe(0.97);
  });

  it('turns the captured rotated signature back into a level shoulder line', () => {
    // The end-to-end property that matters: after correction the shoulders should
    // read side by side (dx dominant) rather than stacked.
    const l11 = correctNormalized2DLandmarkRotation({ x: 0.38, y: 0.84 });
    const l12 = correctNormalized2DLandmarkRotation({ x: 0.39, y: 0.21 });
    expect(Math.abs(l12.x - l11.x)).toBeGreaterThan(Math.abs(l12.y - l11.y));
  });
});

describe('nativePoseCompatibility: applying to a whole frame', () => {
  it('corrects both landmark sets and reports that it fired', () => {
    const normalized = frame({ 11: { x: 0.38, y: 0.84 }, 12: { x: 0.39, y: 0.21 } });
    const world = frame({ 11: { x: 0.02, y: 0.18 }, 12: { x: 0.01, y: -0.16 } });

    const res = applyNativePoseCompatibility(normalized, world);

    expect(res.triggered).toBe(true);
    expect(res.normalizedLandmarks![11].x).toBeCloseTo(0.84);
    expect(res.worldLandmarks![11].x).toBeCloseTo(0.18);
  });

  it('passes both sets through untouched when the guard does not fire', () => {
    const normalized = frame({ 11: { x: 0.62, y: 0.44 }, 12: { x: 0.30, y: 0.45 } });
    const world = frame({ 11: { x: 0.2, y: -0.4 }, 12: { x: -0.2, y: -0.4 } });

    const res = applyNativePoseCompatibility(normalized, world);

    expect(res.triggered).toBe(false);
    expect(res.normalizedLandmarks).toBe(normalized); // same reference, not a copy
    expect(res.worldLandmarks).toBe(world);
  });

  it('still corrects normalized landmarks when world landmarks are absent', () => {
    const normalized = frame({ 11: { x: 0.38, y: 0.84 }, 12: { x: 0.39, y: 0.21 } });

    const res = applyNativePoseCompatibility(normalized, undefined);

    expect(res.triggered).toBe(true);
    expect(res.normalizedLandmarks![11].x).toBeCloseTo(0.84);
    expect(res.worldLandmarks).toBeUndefined();
  });
});
