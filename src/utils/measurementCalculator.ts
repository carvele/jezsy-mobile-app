import type { BodyRatios, WorldLandmark } from './poseDetector';
import { LANDMARK_INDEX as IDX, STATURE_CORRECTION, requiredCalibrationLandmarksAreVisible, MIN_CALIBRATION_JOINT_VISIBILITY } from './poseDetector';

export type Gender = 'male' | 'female' | 'non-binary' | 'prefer_not_to_say';

export interface CrossSection {
  widthRatio: number;
  depthRatio: number;
}

export interface MeasurementInput {
  bodyRatios: BodyRatios;
  heightCm: number;
  gender: Gender;
  worldLandmarks?: WorldLandmark[];
  /**
   * Dual-view cross-section data (width from front scan, depth from side scan).
   * This is the primary driver of accurate circumference measurements.
   */
  crossSections?: {
    bust: CrossSection;
    waist: CrossSection;
    hips: CrossSection;
  };
}

export type MeasurementMethod =
  | 'calibrated_world'
  | 'height_scaled_2d'
  | 'dual_view_mask'
  | 'single_view_fallback';

export type MeasurementEstimate = {
  valueCm: number;
  /** Heuristic, not an empirically calibrated error bound -- pending a real measurement-validation study. */
  uncertaintyCm: number;
  /** Bounded [0, 1]. */
  confidence: number;
  method: MeasurementMethod;
};

export interface EstimatedMeasurements {
  // Linear measurements (cm)
  shoulderWidth: MeasurementEstimate;
  armLength: MeasurementEstimate;
  torsoLength: MeasurementEstimate;
  legLength: MeasurementEstimate;
  inseam: MeasurementEstimate;
  // Circumference estimates (cm)
  bust: MeasurementEstimate;
  waist: MeasurementEstimate;
  hips: MeasurementEstimate;
  // Overall scan quality [0, 1]
  overallConfidence: number;
}

/**
 * Ramanujan's second approximation of an ellipse perimeter.
 */
export function ellipsePerimeter(widthCm: number, depthCm: number): number {
  const a = widthCm / 2;
  const b = depthCm / 2;
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// --- Bounded-heuristic guards -----------------------------------------------
// Every MeasurementEstimate goes through these so a bad upstream value (NaN
// from a degenerate frame, a confidence computed outside [0,1]) can never
// leak into the result -- see makeEstimate below.

const SAFE_FALLBACK_UNCERTAINTY = 5.0; // heuristic pending a real measurement-validation study

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeUncertainty(raw: number): number {
  return Number.isFinite(raw) && raw >= 0 ? raw : SAFE_FALLBACK_UNCERTAINTY;
}

function makeEstimate(valueCm: number, uncertaintyCm: number, confidence: number, method: MeasurementMethod): MeasurementEstimate {
  return {
    valueCm: Number.isFinite(valueCm) ? Math.round(valueCm * 10) / 10 : 0,
    uncertaintyCm: sanitizeUncertainty(uncertaintyCm),
    confidence: clamp01(confidence),
    method,
  };
}

// --- World-space calibration -------------------------------------------------
// Sanity bounds on the world-space stature estimate. These are heuristic --
// not derived from a population study -- and exist only to reject an obviously
// degenerate skeleton (near-zero span from a collapsed pose, or an absurd
// span from a filter/tracking glitch) before it corrupts the derived scale.
const MIN_WORLD_STATURE_UNITS = 0.3;
const MAX_WORLD_STATURE_UNITS = 3.0;

function dist3D(a: WorldLandmark, b: WorldLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function midpoint3D(a: WorldLandmark, b: WorldLandmark): WorldLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

function isJointUsable(lm: WorldLandmark | undefined): lm is WorldLandmark {
  return (
    !!lm &&
    Number.isFinite(lm.x) &&
    Number.isFinite(lm.y) &&
    Number.isFinite(lm.z) &&
    lm.visibility >= MIN_CALIBRATION_JOINT_VISIBILITY
  );
}

function jointsUsable(landmarks: WorldLandmark[], indices: number[]): boolean {
  return indices.every((i) => isJointUsable(landmarks[i]));
}

/**
 * GLOBAL calibration gate: derives cm-per-world-unit from the representative
 * world skeleton, or returns null when the skeleton is not trustworthy enough
 * to derive a scale from at all (missing/unclear calibration joints, or a
 * stature estimate outside a plausible range).
 *
 * A non-null return here does NOT mean every individual measurement may use
 * world calibration -- see canUseWorldForJoints below for the per-measurement
 * gate the frozen plan requires on top of this one.
 */
function computeWorldScale(worldLandmarks: WorldLandmark[] | undefined, heightCm: number): number | null {
  if (!worldLandmarks || worldLandmarks.length < 33) return null;
  if (!requiredCalibrationLandmarksAreVisible(worldLandmarks)) return null;

  const midShoulder = midpoint3D(worldLandmarks[IDX.leftShoulder], worldLandmarks[IDX.rightShoulder]);
  const midHip = midpoint3D(worldLandmarks[IDX.leftHip], worldLandmarks[IDX.rightHip]);
  const midAnkle = midpoint3D(worldLandmarks[IDX.leftAnkle], worldLandmarks[IDX.rightAnkle]);

  const headToShoulder = dist3D(worldLandmarks[IDX.nose], midShoulder);
  const torso = dist3D(midShoulder, midHip);
  const legBase = dist3D(midHip, midAnkle);
  const estimatedWorldStatureUnits = (headToShoulder + torso + legBase) / (1 - STATURE_CORRECTION);

  if (!Number.isFinite(estimatedWorldStatureUnits)) return null;
  if (estimatedWorldStatureUnits <= MIN_WORLD_STATURE_UNITS) return null;
  if (estimatedWorldStatureUnits > MAX_WORLD_STATURE_UNITS) return null;

  return heightCm / estimatedWorldStatureUnits;
}

/** World-space distance between two joints, in cm, or null if either joint fails the per-measurement gate. */
function worldSegmentCm(landmarks: WorldLandmark[], idxA: number, idxB: number, worldScaleCmPerUnit: number): number | null {
  if (!jointsUsable(landmarks, [idxA, idxB])) return null;
  return dist3D(landmarks[idxA], landmarks[idxB]) * worldScaleCmPerUnit;
}

/** World-space articulated (two-segment) length, in cm, or null if any of the three joints fails the per-measurement gate. */
function worldArticulatedCm(landmarks: WorldLandmark[], idxA: number, idxMid: number, idxB: number, worldScaleCmPerUnit: number): number | null {
  if (!jointsUsable(landmarks, [idxA, idxMid, idxB])) return null;
  return (dist3D(landmarks[idxA], landmarks[idxMid]) + dist3D(landmarks[idxMid], landmarks[idxB])) * worldScaleCmPerUnit;
}

/**
 * A single-segment linear measurement (e.g. shoulder-to-shoulder). Uses
 * world calibration only when the global gate passed AND this measurement's
 * own two joints are individually visible/finite -- otherwise falls back to
 * the 2D height-scaled ratio.
 */
function segmentMeasurement(
  worldLandmarks: WorldLandmark[] | undefined,
  worldScaleCmPerUnit: number | null,
  idxA: number,
  idxB: number,
  fallbackRatio: number,
  cmPerUnit: number,
): MeasurementEstimate {
  if (worldScaleCmPerUnit != null && worldLandmarks) {
    const worldCm = worldSegmentCm(worldLandmarks, idxA, idxB, worldScaleCmPerUnit);
    if (worldCm != null) {
      return makeEstimate(worldCm, 1.5, 0.9, 'calibrated_world');
    }
  }
  return makeEstimate(fallbackRatio * cmPerUnit, 3.5, 0.6, 'height_scaled_2d');
}

/**
 * An articulated limb measurement (shoulder->elbow->wrist, hip->knee->ankle).
 * Per the frozen plan's per-measurement gate: each side is evaluated on its
 * own evidence quality, so one badly observed limb cannot drag a good one
 * into an average, or block a good side from being used at all.
 *   left valid + right valid -> average of both
 *   only one valid           -> that side alone
 *   neither valid            -> 2D fallback
 */
function limbMeasurement(
  worldLandmarks: WorldLandmark[] | undefined,
  worldScaleCmPerUnit: number | null,
  leftIdx: readonly [number, number, number],
  rightIdx: readonly [number, number, number],
  fallbackRatio: number,
  cmPerUnit: number,
): MeasurementEstimate {
  if (worldScaleCmPerUnit != null && worldLandmarks) {
    const leftCm = worldArticulatedCm(worldLandmarks, leftIdx[0], leftIdx[1], leftIdx[2], worldScaleCmPerUnit);
    const rightCm = worldArticulatedCm(worldLandmarks, rightIdx[0], rightIdx[1], rightIdx[2], worldScaleCmPerUnit);

    if (leftCm != null && rightCm != null) {
      return makeEstimate((leftCm + rightCm) / 2, 1.5, 0.9, 'calibrated_world');
    }
    if (leftCm != null) return makeEstimate(leftCm, 1.8, 0.8, 'calibrated_world');
    if (rightCm != null) return makeEstimate(rightCm, 1.8, 0.8, 'calibrated_world');
  }
  return makeEstimate(fallbackRatio * cmPerUnit, 3.5, 0.6, 'height_scaled_2d');
}

/** Shared by computeMeasurements' crossSections branch and the caller's post-hoc side-mask override in body-scan.tsx. */
export function estimateCircumferenceFromCrossSection(section: CrossSection, cmPerUnit: number): MeasurementEstimate {
  const widthCm = section.widthRatio * cmPerUnit;
  const depthCm = section.depthRatio * cmPerUnit;
  return makeEstimate(ellipsePerimeter(widthCm, depthCm), 4.8, 0.85, 'dual_view_mask');
}

/**
 * Computes all body measurements from pose ratios, world landmarks (when
 * trustworthy), and cross-sections.
 */
export function computeMeasurements(input: MeasurementInput): EstimatedMeasurements {
  const { bodyRatios, heightCm, crossSections, worldLandmarks, gender } = input;

  // Base linear scale (pixels to cm) calibrated entirely on user height
  const cmPerUnit = heightCm;

  const worldScaleCmPerUnit = computeWorldScale(worldLandmarks, heightCm);

  const shoulderWidth = segmentMeasurement(worldLandmarks, worldScaleCmPerUnit, IDX.leftShoulder, IDX.rightShoulder, bodyRatios.shoulderWidthRatio, cmPerUnit);
  const torsoLength = segmentMeasurement(worldLandmarks, worldScaleCmPerUnit, IDX.leftShoulder, IDX.leftHip, bodyRatios.torsoLengthRatio, cmPerUnit);
  const armLength = limbMeasurement(
    worldLandmarks, worldScaleCmPerUnit,
    [IDX.leftShoulder, IDX.leftElbow, IDX.leftWrist],
    [IDX.rightShoulder, IDX.rightElbow, IDX.rightWrist],
    bodyRatios.armLengthRatio, cmPerUnit,
  );
  const legLength = limbMeasurement(
    worldLandmarks, worldScaleCmPerUnit,
    [IDX.leftHip, IDX.leftKnee, IDX.leftAnkle],
    [IDX.rightHip, IDX.rightKnee, IDX.rightAnkle],
    bodyRatios.legLengthRatio, cmPerUnit,
  );
  // No world-space computation is defined for inseam; it is a fixed
  // fraction of the observed leg span (see poseDetector.ts), always 2D.
  const inseam = makeEstimate(bodyRatios.inseamRatio * cmPerUnit, 3.5, 0.6, 'height_scaled_2d');

  // --- Circumference estimates ---
  let bust: MeasurementEstimate;
  let waist: MeasurementEstimate;
  let hips: MeasurementEstimate;

  if (crossSections) {
    // Primary Pipeline: Dual-view cross-section scan (measured width & measured depth)
    bust = estimateCircumferenceFromCrossSection(crossSections.bust, cmPerUnit);
    waist = estimateCircumferenceFromCrossSection(crossSections.waist, cmPerUnit);
    hips = estimateCircumferenceFromCrossSection(crossSections.hips, cmPerUnit);
  } else {
    // Fallback: Single-view with anthropometrically calibrated depth ratios
    const extremeUncertainty = gender === 'female' ? 8.5 : 10.0;
    const fallbackConfidence = 0.35;

    // Anthropometric depth-to-width ratios by gender
    const depthRatios = gender === 'female'
      ? { bust: 0.68, waist: 0.72, hips: 0.75 }
      : gender === 'male'
      ? { bust: 0.80, waist: 0.78, hips: 0.72 }
      : { bust: 0.70, waist: 0.74, hips: 0.73 };

    const rawBustWidth = bodyRatios.bustWidthRatio * cmPerUnit;
    bust = makeEstimate(ellipsePerimeter(rawBustWidth, rawBustWidth * depthRatios.bust), extremeUncertainty, fallbackConfidence, 'single_view_fallback');

    const rawHipWidth = bodyRatios.hipWidthRatio * cmPerUnit;
    hips = makeEstimate(ellipsePerimeter(rawHipWidth, rawHipWidth * depthRatios.hips), extremeUncertainty, fallbackConfidence, 'single_view_fallback');

    // Waist width derived from anatomical ratio or hip ratio
    const rawWaistWidth = bodyRatios.rawWaistWidthRatio
      ? bodyRatios.rawWaistWidthRatio * cmPerUnit
      : (rawHipWidth * (gender === 'female' ? 0.76 : 0.82));
    waist = makeEstimate(ellipsePerimeter(rawWaistWidth, rawWaistWidth * depthRatios.waist), extremeUncertainty, fallbackConfidence, 'single_view_fallback');
  }

  const measurements = { shoulderWidth, armLength, torsoLength, legLength, inseam, bust, waist, hips };
  const overallConfidence = clamp01(
    Object.values(measurements).reduce((sum, m) => sum + m.confidence, 0) / Object.keys(measurements).length,
  );

  return { ...measurements, overallConfidence };
}
