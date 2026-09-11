import { BurstCollector, type MeasurementEvidenceFrame } from './burstAverager';
import type { BodyRatios, WorldLandmark } from './poseDetector';

function buildWorldLandmarks(leftElbowZ: number): WorldLandmark[] {
  const base: Record<number, WorldLandmark> = {
    0: { x: 0, y: -0.8, z: 0, visibility: 0.95 },
    11: { x: -0.2, y: -0.6, z: 0, visibility: 0.95 },
    12: { x: 0.2, y: -0.6, z: 0, visibility: 0.95 },
    13: { x: -0.3, y: -0.3, z: leftElbowZ, visibility: 0.9 },
    14: { x: 0.3, y: -0.3, z: 0, visibility: 0.9 },
    15: { x: -0.35, y: 0.0, z: 0, visibility: 0.9 },
    16: { x: 0.35, y: 0.0, z: 0, visibility: 0.9 },
    23: { x: -0.15, y: 0.0, z: 0, visibility: 0.95 },
    24: { x: 0.15, y: 0.0, z: 0, visibility: 0.95 },
    25: { x: -0.15, y: 0.4, z: 0, visibility: 0.9 },
    26: { x: 0.15, y: 0.4, z: 0, visibility: 0.9 },
    27: { x: -0.15, y: 0.8, z: 0, visibility: 0.9 },
    28: { x: 0.15, y: 0.8, z: 0, visibility: 0.9 },
  };
  const landmarks: WorldLandmark[] = [];
  for (let i = 0; i < 33; i++) landmarks.push(base[i] ?? { x: 0, y: 0, z: 0, visibility: 0.9 });
  return landmarks;
}

const baseRatios: BodyRatios = {
  shoulderWidthRatio: 0.22,
  hipWidthRatio: 0.19,
  torsoLengthRatio: 0.31,
  armLengthRatio: 0.36,
  legLengthRatio: 0.46,
  inseamRatio: 0.41,
  headToAnkleRatio: 1.0,
  bustWidthRatio: 0.23,
};

function frame(overrides: Partial<MeasurementEvidenceFrame> = {}, leftElbowZ = 0): MeasurementEvidenceFrame {
  return {
    bodyRatios: baseRatios,
    worldLandmarks: buildWorldLandmarks(leftElbowZ),
    orientation: 'front',
    poseConfidence: 0.95,
    ...overrides,
  };
}

describe('BurstCollector -- frame acceptance', () => {
  it('rejects non-front-facing frames', () => {
    const collector = new BurstCollector();
    expect(collector.addSample(frame({ orientation: 'side' }))).toBe(false);
    expect(collector.addSample(frame({ orientation: 'unknown' }))).toBe(false);
    expect(collector.capturedCount).toBe(0);
  });

  it('rejects frames below the pose-confidence floor', () => {
    const collector = new BurstCollector();
    expect(collector.addSample(frame({ poseConfidence: 0.5 }))).toBe(false);
    expect(collector.capturedCount).toBe(0);
  });

  it('accepts a front-facing, sufficiently confident frame', () => {
    const collector = new BurstCollector();
    expect(collector.addSample(frame())).toBe(true);
    expect(collector.capturedCount).toBe(1);
  });
});

describe('BurstCollector -- per-coordinate median aggregation', () => {
  it('computes the median z for the left elbow across 10 noisy frames, robust to one wild frame', () => {
    const collector = new BurstCollector();
    // 10 frames, left-elbow z jittering around 0 with one clear outlier.
    // Outlier rejection in this collector is scoped to body-ratio drift
    // (orientation/pose consistency), not raw per-coordinate values -- a
    // single wild world-landmark coordinate with otherwise-normal ratios
    // is exactly the kind of single-coordinate noise per-coordinate
    // medians (rather than a mean) are meant to absorb.
    const zValues = [0.01, -0.02, 0.03, 0.0, -0.01, 0.02, -0.03, 0.01, 0.0, 5.0];
    for (const z of zValues) collector.addSample(frame({}, z));

    const evidence = collector.getEvidence();
    expect(evidence).not.toBeNull();

    const sorted = [...zValues].sort((a, b) => a - b);
    const expectedMedian = (sorted[4] + sorted[5]) / 2; // even count -> average the two middle values
    expect(evidence!.worldLandmarks![13].z).toBeCloseTo(expectedMedian, 5);

    // The real property under test: the median stays near the jitter band
    // despite the outlier, unlike a mean would (mean of 10 including 5.0
    // is dragged well above 0.5).
    const naiveMean = zValues.reduce((a, b) => a + b, 0) / zValues.length;
    expect(Math.abs(evidence!.worldLandmarks![13].z)).toBeLessThan(Math.abs(naiveMean) / 10);
  });

  it('produces a representative skeleton bounded by the observed frames (never outside their min/max per coordinate)', () => {
    const collector = new BurstCollector();
    const zValues = [0.0, 0.05, -0.05, 0.02, -0.02];
    for (const z of zValues) collector.addSample(frame({}, z));

    const evidence = collector.getEvidence();
    const medianZ = evidence!.worldLandmarks![13].z;
    expect(medianZ).toBeGreaterThanOrEqual(Math.min(...zValues));
    expect(medianZ).toBeLessThanOrEqual(Math.max(...zValues));
  });
});

describe('BurstCollector -- ratio outlier rejection', () => {
  it('excludes a frame whose ratios drift far from the burst before computing medians', () => {
    const collector = new BurstCollector();
    // Four consistent frames...
    for (let i = 0; i < 4; i++) {
      collector.addSample(frame({ bodyRatios: { ...baseRatios, shoulderWidthRatio: 0.22 + i * 0.001 } }));
    }
    // ...and one wild outlier (the person swayed or half-turned mid-burst).
    collector.addSample(frame({ bodyRatios: { ...baseRatios, shoulderWidthRatio: 0.9 } }));

    const evidence = collector.getEvidence();
    // The representative ratio should sit near the consistent cluster
    // (~0.22), not be dragged toward the outlier (0.9).
    expect(evidence!.bodyRatios.shoulderWidthRatio).toBeLessThan(0.3);
  });
});

describe('BurstCollector -- completion and reset', () => {
  it('is complete once 5 valid frames are collected', () => {
    const collector = new BurstCollector();
    for (let i = 0; i < 4; i++) {
      collector.addSample(frame());
      expect(collector.isComplete()).toBe(false);
    }
    collector.addSample(frame());
    expect(collector.isComplete()).toBe(true);
  });

  it('returns null evidence below the minimum frame count', () => {
    const collector = new BurstCollector();
    collector.addSample(frame());
    collector.addSample(frame());
    expect(collector.getEvidence()).toBeNull();
  });

  it('clears all frames on reset', () => {
    const collector = new BurstCollector();
    for (let i = 0; i < 5; i++) collector.addSample(frame());
    expect(collector.isComplete()).toBe(true);
    collector.reset();
    expect(collector.capturedCount).toBe(0);
    expect(collector.getEvidence()).toBeNull();
  });
});

describe('BurstCollector -- getResult end-to-end', () => {
  it('runs computeMeasurements once against the aggregated evidence', () => {
    const collector = new BurstCollector();
    for (let i = 0; i < 5; i++) collector.addSample(frame());
    const result = collector.getResult(178, 'non-binary');
    expect(result).not.toBeNull();
    expect(result!.shoulderWidth.method).toBe('calibrated_world');
  });
});
