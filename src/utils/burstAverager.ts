/**
 * Burst capture noise-reduction via multi-frame evidence aggregation.
 *
 * Collects 3-5 valid front-facing frames' raw measurement evidence (body
 * ratios + world landmarks), rejects statistical outliers, then reduces the
 * survivors to a single representative frame via per-coordinate medians
 * before running the measurement math exactly once. This is a change from
 * averaging each frame's already-computed cm values: median-of-evidence is
 * more robust to single-frame pose jitter than mean-of-results, and running
 * computeMeasurements once instead of once per frame is a meaningful cost
 * saving on a 12fps capture loop.
 */

import type { BodyRatios, WorldLandmark, PoseOrientation } from './poseDetector';
import { computeMeasurements, type EstimatedMeasurements, type Gender, type MeasurementInput } from './measurementCalculator';

// Number of valid frames to collect before completing the burst
const TARGET_FRAMES = 5;
const MIN_FRAMES = 3; // Accept if we can't get TARGET_FRAMES

// A frame is accepted into the burst only if it clears this pose-confidence
// floor -- matches isPoseValid's own 0.85 bar in poseDetector.ts, since a
// frame that wouldn't itself pass isPoseValid has no business influencing
// the representative skeleton.
const MIN_FRAME_POSE_CONFIDENCE = 0.85;

const RATIO_KEYS: (keyof BodyRatios)[] = [
  'shoulderWidthRatio', 'hipWidthRatio', 'torsoLengthRatio',
  'armLengthRatio', 'legLengthRatio', 'inseamRatio', 'bustWidthRatio',
];

/**
 * One frame's raw evidence, offered to the collector. `orientation` and
 * `poseConfidence` exist purely so the collector can reject a frame before
 * it ever contributes to the median -- they are not part of the aggregated
 * result the measurement math consumes.
 */
export interface MeasurementEvidenceFrame {
  bodyRatios: BodyRatios;
  worldLandmarks?: WorldLandmark[];
  orientation: PoseOrientation;
  poseConfidence: number;
}

/** The aggregated representative frame computeMeasurements is run against exactly once. */
export interface MeasurementEvidence {
  bodyRatios: BodyRatios;
  worldLandmarks?: WorldLandmark[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Rejects frames whose body ratios drift materially from the burst's own
 * distribution (Z-score > 2.0 on any ratio) -- the same outlier-rejection
 * intent as before, just applied to raw ratios instead of derived cm values,
 * and run BEFORE median aggregation rather than after averaging. A person
 * swaying or half-turning mid-burst produces exactly this kind of drift; the
 * frozen plan requires filtering it out before coordinate medians are taken,
 * since combining differently-posed frames coordinate-by-coordinate can
 * synthesize a skeleton that never existed in any single frame.
 */
function rejectOutlierFrames(frames: MeasurementEvidenceFrame[]): MeasurementEvidenceFrame[] {
  const meansByKey = new Map<keyof BodyRatios, number>();
  const sdsByKey = new Map<keyof BodyRatios, number>();
  for (const key of RATIO_KEYS) {
    const values = frames.map((f) => f.bodyRatios[key] ?? 0);
    const mu = mean(values);
    meansByKey.set(key, mu);
    sdsByKey.set(key, stdDev(values, mu));
  }

  const kept = frames.filter((f) =>
    RATIO_KEYS.every((key) => {
      const sd = sdsByKey.get(key)!;
      if (sd === 0) return true;
      const z = Math.abs((f.bodyRatios[key] ?? 0) - meansByKey.get(key)!) / sd;
      return z <= 2.0;
    }),
  );

  return kept.length >= MIN_FRAMES ? kept : frames;
}

/** Median of a BodyRatios field across frames. */
function medianRatio(frames: MeasurementEvidenceFrame[], key: keyof BodyRatios): number {
  return median(frames.map((f) => f.bodyRatios[key] ?? 0));
}

/**
 * Per-coordinate median across every landmark's x/y/z/visibility
 * independently, building a representative world skeleton that is robust
 * to single-coordinate noise in any one frame. Only computed over frames
 * that already survived orientation/confidence/outlier filtering above --
 * per-coordinate medians of materially different poses could otherwise
 * synthesize a skeleton no single frame ever produced.
 */
function medianWorldLandmarks(frames: MeasurementEvidenceFrame[]): WorldLandmark[] | undefined {
  const withWorld = frames.filter((f) => f.worldLandmarks && f.worldLandmarks.length >= 33);
  if (withWorld.length < MIN_FRAMES) return undefined;

  const landmarkCount = withWorld[0].worldLandmarks!.length;
  const result: WorldLandmark[] = [];
  for (let i = 0; i < landmarkCount; i++) {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const vis: number[] = [];
    for (const f of withWorld) {
      const lm = f.worldLandmarks![i];
      if (!lm) continue;
      xs.push(lm.x);
      ys.push(lm.y);
      zs.push(lm.z);
      vis.push(lm.visibility);
    }
    if (xs.length === 0) {
      result.push({ x: 0, y: 0, z: 0, visibility: 0 });
      continue;
    }
    result.push({ x: median(xs), y: median(ys), z: median(zs), visibility: median(vis) });
  }
  return result;
}

export class BurstCollector {
  private frames: MeasurementEvidenceFrame[] = [];

  /**
   * Offer one frame's evidence. Rejects (returns false, does not count
   * toward the target) any frame that is not a front-facing, sufficiently
   * confident pose -- per the frozen plan's frame-acceptance contract.
   * Ratio-outlier rejection happens later, across the whole burst, in
   * getResult(), since a single frame's ratios can't be judged an outlier
   * in isolation.
   */
  addSample(frame: MeasurementEvidenceFrame): boolean {
    if (frame.orientation !== 'front') return false;
    if (frame.poseConfidence < MIN_FRAME_POSE_CONFIDENCE) return false;
    this.frames.push(frame);
    return true;
  }

  /** True once enough valid samples are collected. */
  isComplete(): boolean {
    return this.frames.length >= TARGET_FRAMES;
  }

  /** How many frames have been captured so far. */
  get capturedCount(): number {
    return this.frames.length;
  }

  /** Target number of frames. */
  get targetCount(): number {
    return TARGET_FRAMES;
  }

  /** Reset for a new scan attempt. */
  reset(): void {
    this.frames = [];
  }

  /**
   * Builds the representative evidence frame (median ratios + median world
   * skeleton across outlier-filtered frames), without running the
   * measurement math. Exposed mainly for tests; getResult() is the normal
   * caller-facing entry point.
   */
  getEvidence(): MeasurementEvidence | null {
    if (this.frames.length < MIN_FRAMES) return null;

    const finalFrames = rejectOutlierFrames(this.frames);

    const bodyRatios = {
      shoulderWidthRatio: medianRatio(finalFrames, 'shoulderWidthRatio'),
      hipWidthRatio: medianRatio(finalFrames, 'hipWidthRatio'),
      torsoLengthRatio: medianRatio(finalFrames, 'torsoLengthRatio'),
      armLengthRatio: medianRatio(finalFrames, 'armLengthRatio'),
      legLengthRatio: medianRatio(finalFrames, 'legLengthRatio'),
      inseamRatio: medianRatio(finalFrames, 'inseamRatio'),
      headToAnkleRatio: 1.0,
      bustWidthRatio: medianRatio(finalFrames, 'bustWidthRatio'),
      rawWaistWidthRatio: finalFrames.some((f) => f.bodyRatios.rawWaistWidthRatio != null)
        ? median(finalFrames.map((f) => f.bodyRatios.rawWaistWidthRatio ?? 0))
        : undefined,
    };

    return { bodyRatios, worldLandmarks: medianWorldLandmarks(finalFrames) };
  }

  /** Runs computeMeasurements once against the aggregated representative evidence. */
  getResult(heightCm: number, gender: Gender, crossSections?: MeasurementInput['crossSections']): EstimatedMeasurements | null {
    const evidence = this.getEvidence();
    if (!evidence) return null;

    return computeMeasurements({
      bodyRatios: evidence.bodyRatios,
      worldLandmarks: evidence.worldLandmarks,
      heightCm,
      gender,
      crossSections,
    });
  }
}
