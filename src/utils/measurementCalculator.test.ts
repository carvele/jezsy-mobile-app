import { computeMeasurements, type MeasurementInput } from './measurementCalculator';
import type { BodyRatios, WorldLandmark } from './poseDetector';

// A simple, symmetric standing stick figure in nominal world units (NOT
// meters -- the whole point of this rework is that these are uncalibrated).
// Index layout matches BlazePose: 0 nose, 11/12 shoulders, 13/14 elbows,
// 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles.
function buildWorldLandmarks(overrides: Partial<Record<number, Partial<WorldLandmark>>> = {}): WorldLandmark[] {
  const base: Record<number, WorldLandmark> = {
    0: { x: 0, y: -0.8, z: 0, visibility: 0.95 }, // nose
    11: { x: -0.2, y: -0.6, z: 0, visibility: 0.95 }, // left shoulder
    12: { x: 0.2, y: -0.6, z: 0, visibility: 0.95 }, // right shoulder
    13: { x: -0.3, y: -0.3, z: 0, visibility: 0.9 }, // left elbow
    14: { x: 0.3, y: -0.3, z: 0, visibility: 0.9 }, // right elbow
    15: { x: -0.35, y: 0.0, z: 0, visibility: 0.9 }, // left wrist
    16: { x: 0.35, y: 0.0, z: 0, visibility: 0.9 }, // right wrist
    23: { x: -0.15, y: 0.0, z: 0, visibility: 0.95 }, // left hip
    24: { x: 0.15, y: 0.0, z: 0, visibility: 0.95 }, // right hip
    25: { x: -0.15, y: 0.4, z: 0, visibility: 0.9 }, // left knee
    26: { x: 0.15, y: 0.4, z: 0, visibility: 0.9 }, // right knee
    27: { x: -0.15, y: 0.8, z: 0, visibility: 0.9 }, // left ankle
    28: { x: 0.15, y: 0.8, z: 0, visibility: 0.9 }, // right ankle
  };

  const landmarks: WorldLandmark[] = [];
  for (let i = 0; i < 33; i++) {
    const b = base[i] ?? { x: 0, y: 0, z: 0, visibility: 0.9 };
    const o = overrides[i] ?? {};
    landmarks.push({ x: o.x ?? b.x, y: o.y ?? b.y, z: o.z ?? b.z, visibility: o.visibility ?? b.visibility });
  }
  return landmarks;
}

// STATURE_CORRECTION = 0.114, matching poseDetector.ts's exported constant.
// headToShoulder(0.2) + torso(0.6) + legBase(0.8) = 1.6 world units.
const WORLD_STATURE_UNITS = 1.6 / (1 - 0.114);
const HEIGHT_CM = 178;
const EXPECTED_WORLD_SCALE = HEIGHT_CM / WORLD_STATURE_UNITS;

const bodyRatios: BodyRatios = {
  shoulderWidthRatio: 0.22,
  hipWidthRatio: 0.19,
  torsoLengthRatio: 0.31,
  armLengthRatio: 0.36,
  legLengthRatio: 0.46,
  inseamRatio: 0.41,
  headToAnkleRatio: 1.0,
  bustWidthRatio: 0.23,
};

function baseInput(overrides: Partial<MeasurementInput> = {}): MeasurementInput {
  return {
    bodyRatios,
    heightCm: HEIGHT_CM,
    gender: 'non-binary',
    ...overrides,
  };
}

describe('computeMeasurements -- world calibration', () => {
  it('calibrates world distances to the known heightCm', () => {
    const result = computeMeasurements(baseInput({ worldLandmarks: buildWorldLandmarks() }));

    // shoulder width (world) = 0.4 world units * scale
    expect(result.shoulderWidth.method).toBe('calibrated_world');
    expect(result.shoulderWidth.valueCm).toBeCloseTo(0.4 * EXPECTED_WORLD_SCALE, 0);

    // arm length (world, articulated, both sides equal by construction):
    // (shoulder->elbow) + (elbow->wrist), left == right here.
    const shoulderToElbow = Math.hypot(0.1, 0.3);
    const elbowToWrist = Math.hypot(0.05, 0.3);
    const expectedArmCm = (shoulderToElbow + elbowToWrist) * EXPECTED_WORLD_SCALE;
    expect(result.armLength.method).toBe('calibrated_world');
    expect(result.armLength.valueCm).toBeCloseTo(expectedArmCm, 0);
  });

  it('falls back to height_scaled_2d when worldLandmarks are missing entirely', () => {
    const result = computeMeasurements(baseInput());
    expect(result.shoulderWidth.method).toBe('height_scaled_2d');
    expect(result.armLength.method).toBe('height_scaled_2d');
    expect(result.legLength.method).toBe('height_scaled_2d');
    expect(result.torsoLength.method).toBe('height_scaled_2d');
    expect(result.shoulderWidth.valueCm).toBeCloseTo(bodyRatios.shoulderWidthRatio * HEIGHT_CM, 1);
  });

  it('falls back to height_scaled_2d when calibration joints are present but poorly visible', () => {
    // Nose (a global calibration joint) barely visible -> the global gate
    // fails, so nothing may use world calibration even though every other
    // joint looks fine.
    const landmarks = buildWorldLandmarks({ 0: { visibility: 0.1 } });
    const result = computeMeasurements(baseInput({ worldLandmarks: landmarks }));
    expect(result.shoulderWidth.method).toBe('height_scaled_2d');
    expect(result.armLength.method).toBe('height_scaled_2d');
  });

  it('falls back to height_scaled_2d when the world stature estimate is degenerate (near zero)', () => {
    // Collapse the whole skeleton onto a single point -> stature ~ 0,
    // below MIN_WORLD_STATURE_UNITS.
    const collapsed = buildWorldLandmarks();
    const flattened = collapsed.map((lm) => ({ ...lm, x: 0, y: 0, z: 0 }));
    const result = computeMeasurements(baseInput({ worldLandmarks: flattened }));
    expect(result.shoulderWidth.method).toBe('height_scaled_2d');
  });
});

describe('computeMeasurements -- per-measurement gate for articulated limbs', () => {
  it('averages both sides when left and right are both individually valid', () => {
    const result = computeMeasurements(baseInput({ worldLandmarks: buildWorldLandmarks() }));
    expect(result.armLength.method).toBe('calibrated_world');
    // Symmetric fixture: left == right, so average == either side.
    const shoulderToElbow = Math.hypot(0.1, 0.3);
    const elbowToWrist = Math.hypot(0.05, 0.3);
    expect(result.armLength.valueCm).toBeCloseTo((shoulderToElbow + elbowToWrist) * EXPECTED_WORLD_SCALE, 0);
  });

  it('uses only the valid side when the other side is poorly observed, without falling back to 2D', () => {
    // Left wrist poorly observed; right wrist/elbow good. Per the frozen
    // plan's clarification, this must NOT force a 2-sided average
    // containing a bad limb, and must NOT drop all the way to a 2D
    // fallback either -- the right arm alone is still usable.
    const landmarks = buildWorldLandmarks({ 15: { visibility: 0.1 } });
    const result = computeMeasurements(baseInput({ worldLandmarks: landmarks }));

    expect(result.armLength.method).toBe('calibrated_world');
    const shoulderToElbow = Math.hypot(0.1, 0.3);
    const elbowToWrist = Math.hypot(0.05, 0.3);
    const expectedRightArmCm = (shoulderToElbow + elbowToWrist) * EXPECTED_WORLD_SCALE;
    expect(result.armLength.valueCm).toBeCloseTo(expectedRightArmCm, 0);

    // An unrelated single-segment measurement (shoulders) is unaffected by
    // the wrist being poorly observed -- the per-measurement gate is scoped
    // to the joints each specific measurement actually needs.
    expect(result.shoulderWidth.method).toBe('calibrated_world');
  });

  it('falls back to 2D only when neither side is sufficiently valid', () => {
    const landmarks = buildWorldLandmarks({
      15: { visibility: 0.1 }, // left wrist
      16: { visibility: 0.1 }, // right wrist
    });
    const result = computeMeasurements(baseInput({ worldLandmarks: landmarks }));
    expect(result.armLength.method).toBe('height_scaled_2d');
    // Shoulder width (different joints) still calibrates from world data --
    // proving the gate is per-measurement, not a single global switch.
    expect(result.shoulderWidth.method).toBe('calibrated_world');
  });
});

describe('computeMeasurements -- circumferences', () => {
  it('uses dual_view_mask when cross-sections are supplied', () => {
    const result = computeMeasurements(baseInput({
      crossSections: {
        bust: { widthRatio: 0.5, depthRatio: 0.3 },
        waist: { widthRatio: 0.45, depthRatio: 0.28 },
        hips: { widthRatio: 0.52, depthRatio: 0.32 },
      },
    }));
    expect(result.bust.method).toBe('dual_view_mask');
    expect(result.waist.method).toBe('dual_view_mask');
    expect(result.hips.method).toBe('dual_view_mask');
  });

  it('uses single_view_fallback when no cross-sections are supplied', () => {
    const result = computeMeasurements(baseInput());
    expect(result.bust.method).toBe('single_view_fallback');
    expect(result.waist.method).toBe('single_view_fallback');
    expect(result.hips.method).toBe('single_view_fallback');
  });
});

describe('computeMeasurements -- bounded heuristics contract', () => {
  it('keeps every confidence in [0, 1] and every uncertainty finite and non-negative', () => {
    const scenarios: MeasurementInput[] = [
      baseInput(),
      baseInput({ worldLandmarks: buildWorldLandmarks() }),
      baseInput({ worldLandmarks: buildWorldLandmarks({ 15: { visibility: 0.1 } }) }),
      baseInput({ crossSections: { bust: { widthRatio: 0.5, depthRatio: 0.3 }, waist: { widthRatio: 0.45, depthRatio: 0.28 }, hips: { widthRatio: 0.52, depthRatio: 0.32 } } }),
    ];

    for (const input of scenarios) {
      const result = computeMeasurements(input);
      const fields = ['shoulderWidth', 'armLength', 'torsoLength', 'legLength', 'inseam', 'bust', 'waist', 'hips'] as const;
      for (const field of fields) {
        const estimate = result[field];
        expect(estimate.confidence).toBeGreaterThanOrEqual(0);
        expect(estimate.confidence).toBeLessThanOrEqual(1);
        expect(Number.isFinite(estimate.uncertaintyCm)).toBe(true);
        expect(estimate.uncertaintyCm).toBeGreaterThanOrEqual(0);
      }
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.overallConfidence).toBeLessThanOrEqual(1);
    }
  });
});
