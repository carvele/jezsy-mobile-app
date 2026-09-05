import { computeLengthFitSignal } from '../sizeRecommender';

/**
 * Only the length-fit signal added in Phase 3 -- see sizeRecommender.ts's own
 * comment for why the "expected drop" baseline (LENGTH_TYPICAL_HIP_DROP_CM) exists:
 * a garment's chart length legitimately exceeds pure shoulder-to-hip torso length by
 * design, so comparing against zero would misclassify almost every real garment as
 * "runs_long". These tests pin the bucketing around that baseline, not around zero.
 */

/** World landmarks with a real, computable shoulder-to-hip distance. Only indices
 * 11/12 (shoulders) and 23/24 (hips) matter to the function under test. */
function landmarksForTorsoLengthCm(torsoLengthCm: number): { x: number; y: number; z: number }[] {
  const arr = Array(25).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  // Shoulders at y=0, hips straight down at y = -torsoLengthM -- a pure vertical span
  // of exactly the requested length, in metres (world landmarks are metric).
  const torsoLengthM = torsoLengthCm / 100;
  arr[11] = { x: 0.1, y: 0, z: 0 };
  arr[12] = { x: -0.1, y: 0, z: 0 };
  arr[23] = { x: 0.1, y: -torsoLengthM, z: 0 };
  arr[24] = { x: -0.1, y: -torsoLengthM, z: 0 };
  return arr;
}

describe('computeLengthFitSignal: returns null without enough real data', () => {
  it('returns null with no landmarks', () => {
    expect(computeLengthFitSignal(null, 65)).toBeNull();
    expect(computeLengthFitSignal(undefined, 65)).toBeNull();
    expect(computeLengthFitSignal([], 65)).toBeNull();
  });

  it('returns null with no chart length', () => {
    const lm = landmarksForTorsoLengthCm(45);
    expect(computeLengthFitSignal(lm, null)).toBeNull();
    expect(computeLengthFitSignal(lm, undefined)).toBeNull();
    expect(computeLengthFitSignal(lm, 0)).toBeNull();
    expect(computeLengthFitSignal(lm, -5)).toBeNull();
  });

  it('returns null when a required shoulder or hip landmark is missing', () => {
    const lm = landmarksForTorsoLengthCm(45);
    lm[23] = null as any;
    expect(computeLengthFitSignal(lm, 65)).toBeNull();
  });

  it('returns null when the landmark array is too short to contain the hip indices', () => {
    const lm = landmarksForTorsoLengthCm(45).slice(0, 13); // shoulders only, no hips
    expect(computeLengthFitSignal(lm, 65)).toBeNull();
  });
});

describe('computeLengthFitSignal: bucketing around the expected-drop baseline, not zero', () => {
  // Torso length 45cm -> expected/"appropriate" chart length centers on
  // 45 + 20 (LENGTH_TYPICAL_HIP_DROP_CM) = 65cm, +/- 15 (LENGTH_EASE_CM).

  it('reads a garment at the expected drop as appropriate', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65);
    expect(res?.verdict).toBe('appropriate');
  });

  it('reads a garment within the ease band above the expected drop as appropriate', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65 + 14);
    expect(res?.verdict).toBe('appropriate');
  });

  it('reads a garment within the ease band below the expected drop as appropriate', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65 - 14);
    expect(res?.verdict).toBe('appropriate');
  });

  it('reads a garment noticeably longer than the expected drop as runs_long', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65 + 20);
    expect(res?.verdict).toBe('runs_long');
  });

  it('reads a garment shorter than the torso itself as runs_short', () => {
    // Zero-centered thinking would call this "long" (65cm chart vs 45cm torso); the
    // whole point of the baseline is that a garment shorter than expected -- even one
    // still longer than the bare torso -- correctly reads as running short.
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65 - 20);
    expect(res?.verdict).toBe('runs_short');
  });

  it('reads a garment literally shorter than the torso as runs_short, not appropriate', () => {
    // The scenario a naive zero-centered comparison would get right by accident but
    // this baseline-aware version must also get right: a garment that would not even
    // reach the wearer's hip.
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 40);
    expect(res?.verdict).toBe('runs_short');
  });

  it('scales the same way for a different torso length, not a fixed chart-length cutoff', () => {
    // A 60cm chart length should read differently against a 40cm torso (short person)
    // vs. a 55cm torso (tall person) -- the baseline moves with the tracked torso, it
    // is not a fixed number.
    const shortWearer = computeLengthFitSignal(landmarksForTorsoLengthCm(40), 60);
    const tallWearer = computeLengthFitSignal(landmarksForTorsoLengthCm(56), 60);
    expect(shortWearer?.verdict).toBe('appropriate'); // target 60, delta 0
    expect(tallWearer?.verdict).toBe('runs_short'); // target 76, delta -16 -- clearly past the -15 boundary once the identical 60cm chart length is measured against a taller wearer
  });
});

describe('computeLengthFitSignal: returned values', () => {
  it('reports the tracked torso length and chart length it computed from', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65);
    expect(res?.trackedTorsoLengthCm).toBeCloseTo(45, 0);
    expect(res?.chartLengthCm).toBe(65);
  });

  it('computes deltaCm relative to the expected-drop target, not to raw torso length', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65);
    // target = 45 + 20 = 65; chart 65 -> delta 0
    expect(res?.deltaCm).toBeCloseTo(0, 0);
  });

  it('never returns NaN or a non-finite delta for valid input', () => {
    const res = computeLengthFitSignal(landmarksForTorsoLengthCm(45), 65);
    expect(Number.isFinite(res!.deltaCm)).toBe(true);
    expect(Number.isFinite(res!.trackedTorsoLengthCm)).toBe(true);
  });
});
