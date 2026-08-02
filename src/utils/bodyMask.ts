/**
 * Measures body extent from a MediaPipe segmentation mask.
 *
 * The 33 pose landmarks are joints, and joints sit roughly on the body's
 * centreline -- from a side view they say nothing about how thick the torso
 * is. That is why the front-only pipeline could never measure depth and had
 * to infer it from BMI instead.
 *
 * The segmentation mask does carry it: it is a per-pixel person/background
 * map, so scanning one row gives the body's true horizontal extent at that
 * height. Front view gives width, side view gives depth.
 */

import type { Landmark } from './poseDetector';

export type MaskLike = {
  width: number;
  height: number;
  uint8Data?: Uint8Array;
  float32Data?: Float32Array;
};

// Landmark indices reused here rather than imported, to keep this file
// independent of the detector's internals.
const L = { leftShoulder: 11, rightShoulder: 12, leftHip: 23, rightHip: 24 } as const;

// A pixel counts as body above this. UINT8 masks are 0-255, FLOAT32 are 0-1;
// both are confidences, not hard labels, so the cut sits above halfway to
// keep soft edges out.
const UINT8_CUT = 160;
const FLOAT_CUT = 0.6;

// Rows are sampled in a small band and the median taken, because a single row
// can clip a belt, a fold or a stray hand.
const BAND_ROWS = 5;

function isBody(mask: MaskLike, index: number): boolean {
  if (mask.uint8Data) return mask.uint8Data[index] >= UINT8_CUT;
  if (mask.float32Data) return mask.float32Data[index] >= FLOAT_CUT;
  return false;
}

/**
 * Horizontal extent of the body at one normalized height, as a fraction of
 * mask width. Returns null when the row holds no body pixels, or when the run
 * is so narrow it is more likely noise than a torso.
 */
function extentAtRow(mask: MaskLike, normalizedY: number): number | null {
  const y = Math.round(normalizedY * (mask.height - 1));
  if (y < 0 || y >= mask.height) return null;

  const rowStart = y * mask.width;
  let first = -1;
  let last = -1;

  for (let x = 0; x < mask.width; x++) {
    if (isBody(mask, rowStart + x)) {
      if (first === -1) first = x;
      last = x;
    }
  }

  if (first === -1 || last <= first) return null;
  const extent = (last - first + 1) / mask.width;
  // Two pixels of noise in an empty row would otherwise read as a body.
  return extent < 0.02 ? null : extent;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median extent across a small band of rows centred on normalizedY. */
export function measureExtentAt(mask: MaskLike, normalizedY: number): number | null {
  if (!mask.width || !mask.height) return null;

  const spread = 0.01; // ~1% of frame height either side
  const samples: number[] = [];
  for (let i = 0; i < BAND_ROWS; i++) {
    const offset = (i / (BAND_ROWS - 1) - 0.5) * 2 * spread;
    const value = extentAtRow(mask, normalizedY + offset);
    if (value !== null) samples.push(value);
  }

  return samples.length ? median(samples) : null;
}

export type BodyExtents = {
  /** All normalized to the mask's own width. */
  bust: number;
  waist: number;
  hips: number;
};

/**
 * Extents at bust, waist and hip height. The heights come from the landmarks
 * so they track the actual person rather than fixed fractions of the frame:
 * bust just below the shoulder line, hips at the hip line, waist between them
 * at roughly the natural waist.
 */
export function extractBodyExtents(
  landmarks: Landmark[],
  mask: MaskLike,
): BodyExtents | null {
  if (landmarks.length < 33) return null;

  const shoulderY = (landmarks[L.leftShoulder].y + landmarks[L.rightShoulder].y) / 2;
  const hipY = (landmarks[L.leftHip].y + landmarks[L.rightHip].y) / 2;
  if (!(hipY > shoulderY)) return null;

  const torso = hipY - shoulderY;
  const bustY = shoulderY + torso * 0.18;
  const waistY = shoulderY + torso * 0.62;
  const hipsY = hipY;

  const bust = measureExtentAt(mask, bustY);
  const waist = measureExtentAt(mask, waistY);
  const hips = measureExtentAt(mask, hipsY);

  if (bust === null || waist === null || hips === null) return null;
  return { bust, waist, hips };
}
