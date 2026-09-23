/**
 * BodyFitEstimator
 *
 * Implements authoritative body-size semantics, source priority,
 * and stable slow BODY FIT STATE for garment fitting.
 *
 * Explicitly separates:
 *  - SKELETAL HIP SPAN: distance between MediaPipe femoral head joints (~0.14-0.20m)
 *  - BODY OUTER HIP WIDTH: estimated physical outside body width at hip level (~0.32-0.38m)
 *  - GARMENT HIP WIDTH: outer authored garment reference width at HIP fit band (~0.35-0.39m)
 *
 * Priority order:
 *  A. User sizing / body profile (converted via ellipse cross-section model)
 *  B. MediaPipe segmentation silhouette cross-section
 *  C. Anthropometric stature-based estimator
 *  D. Documented anatomical skeletal inference (femoral head + lateral soft tissue)
 */

import type { UserMeasurements } from './sizeRecommender';
import { ellipsePerimeter } from './measurementCalculator';

export type SkeletalHipSpanM = number;
export type BodyOuterHipWidthM = number;
export type GarmentHipWidthM = number;

export type BodyFitSource =
  | 'USER_SIZING'
  | 'SILHOUETTE_SEGMENTATION'
  | 'STATURE_ESTIMATE'
  | 'SKELETAL_INFERRED';

export interface BodyFitState {
  waistWidthM: number;
  hipWidthM: number;
  bodyOuterHipWidthM: number;
  shoulderWidthM: number;
  bodyOuterShoulderWidthM: number;
  skeletalHipSpanM?: number;
  upperThighWidthM?: number;
  bodyDepthM?: number;
  confidence: number;
  lastUpdatedMs: number;
  source: BodyFitSource;
  isLocked: boolean;
}

export interface BodyFitInput {
  userMeasurements?: UserMeasurements | null;
  sizingMeasurements?: {
    shoulderWidth?: number | null;
    hips?: number | null;
    waist?: number | null;
    height?: number | null;
  } | null;
  skeletalHipSpanM?: number | null;
  skeletalShoulderSpanM?: number | null;
  yawRad?: number;
  confidence?: number;
  isTrackingValid?: boolean;
  statureM?: number | null;
  segmentationExtentM?: number | null;
}

/**
 * Depth-to-width ratio from anthropometric literature and measurementCalculator.
 * Female standard: hips ~0.73, waist ~0.72.
 */
export const HIP_DEPTH_TO_WIDTH_RATIO = 0.73;
export const WAIST_DEPTH_TO_WIDTH_RATIO = 0.72;

/**
 * Precomputed ellipse perimeter factors for unit frontal width (W=1, D=ratio).
 * ellipsePerimeter(1, 0.73) ≈ 2.7352
 * ellipsePerimeter(1, 0.72) ≈ 2.7153
 */
export const HIP_ELLIPSE_PERIMETER_FACTOR = ellipsePerimeter(1.0, HIP_DEPTH_TO_WIDTH_RATIO);
export const WAIST_ELLIPSE_PERIMETER_FACTOR = ellipsePerimeter(1.0, WAIST_DEPTH_TO_WIDTH_RATIO);
export const ELLIPSE_CIRCUMFERENCE_FACTOR = HIP_ELLIPSE_PERIMETER_FACTOR;

/**
 * Anthropometric structural offset for adult pelvis:
 * Distance from femoral head center to greater trochanter and lateral soft tissue
 * (tensor fasciae latae, gluteal fat pad) is ~0.075m per side = 0.15m total.
 */
export const SKELETAL_TO_OUTER_HIP_OFFSET_M = 0.15;

/**
 * Calculates skeletal hip span between femoral head landmarks (23 and 24).
 */
export function calculateSkeletalHipSpan(landmarks: Array<{ x: number; y: number; z?: number }>): number {
  if (!landmarks || landmarks.length < 25 || !landmarks[23] || !landmarks[24]) return 0.18;
  const dx = landmarks[24].x - landmarks[23].x;
  const dy = landmarks[24].y - landmarks[23].y;
  const dz = (landmarks[24].z ?? 0) - (landmarks[23].z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculates skeletal shoulder span between acromion/glenohumeral landmarks (11 and 12).
 */
export function calculateSkeletalShoulderSpan(landmarks: Array<{ x: number; y: number; z?: number }>): number {
  if (!landmarks || landmarks.length < 13 || !landmarks[11] || !landmarks[12]) return 0.36;
  const dx = landmarks[12].x - landmarks[11].x;
  const dy = landmarks[12].y - landmarks[11].y;
  const dz = (landmarks[12].z ?? 0) - (landmarks[11].z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Derives body outer hip width with detailed source and confidence.
 */
export function deriveBodyOuterHipWidthWithSource(input: BodyFitInput): {
  hipWidthM: BodyOuterHipWidthM;
  source: BodyFitSource;
  confidence: number;
} {
  // Priority A: User sizing / body profile with circumference
  const hipsCircumferenceCm = input.userMeasurements?.hips || input.sizingMeasurements?.hips;
  if (hipsCircumferenceCm && Number.isFinite(hipsCircumferenceCm) && hipsCircumferenceCm > 50 && hipsCircumferenceCm < 160) {
    const hipWidthM = hipsCircumferenceCm / (HIP_ELLIPSE_PERIMETER_FACTOR * 100);
    return {
      hipWidthM,
      source: 'USER_SIZING',
      confidence: 0.95,
    };
  }

  // Priority B: Segmentation silhouette cross-section at hip level
  if (input.segmentationExtentM && Number.isFinite(input.segmentationExtentM) && input.segmentationExtentM > 0.22 && input.segmentationExtentM < 0.55) {
    return {
      hipWidthM: input.segmentationExtentM,
      source: 'SILHOUETTE_SEGMENTATION',
      confidence: 0.85,
    };
  }

  // Priority C: Anthropometric stature-based estimator
  const statureM = input.sizingMeasurements?.height ? (input.sizingMeasurements.height / 100) : input.statureM;
  if (statureM && Number.isFinite(statureM) && statureM > 1.2 && statureM < 2.2) {
    const hipWidthM = statureM * 0.205;
    return {
      hipWidthM,
      source: 'STATURE_ESTIMATE',
      confidence: 0.75,
    };
  }

  // Priority D: Documented anatomical skeletal inference
  const skeletalSpan = input.skeletalHipSpanM;
  if (skeletalSpan && Number.isFinite(skeletalSpan) && skeletalSpan > 0.05 && skeletalSpan < 0.35) {
    const hipWidthM = skeletalSpan + SKELETAL_TO_OUTER_HIP_OFFSET_M;
    return {
      hipWidthM,
      source: 'SKELETAL_INFERRED',
      confidence: 0.60,
    };
  }

  return {
    hipWidthM: 0.345,
    source: 'STATURE_ESTIMATE',
    confidence: 0.40,
  };
}

/**
 * Derives body outer hip width in meters following strict priority A -> B -> C -> D.
 * Supports direct numerical hips cm or a structured BodyFitInput.
 */
export function deriveBodyOuterHipWidth(
  inputOrHipsCm?: BodyFitInput | number | null,
  _waistCm?: number | null
): number {
  if (typeof inputOrHipsCm === 'number') {
    if (inputOrHipsCm > 50 && inputOrHipsCm < 160) {
      return inputOrHipsCm / (HIP_ELLIPSE_PERIMETER_FACTOR * 100);
    }
    return 0.345;
  }
  const input = (inputOrHipsCm && typeof inputOrHipsCm === 'object') ? inputOrHipsCm : {};
  return deriveBodyOuterHipWidthWithSource(input).hipWidthM;
}

/**
 * Derives body outer waist width in meters.
 */
export function deriveBodyOuterWaistWidth(input: BodyFitInput, outerHipWidthM: number): number {
  const waistCircumferenceCm = input.userMeasurements?.waist || input.sizingMeasurements?.waist;
  if (waistCircumferenceCm && Number.isFinite(waistCircumferenceCm) && waistCircumferenceCm > 40 && waistCircumferenceCm < 140) {
    return waistCircumferenceCm / (WAIST_ELLIPSE_PERIMETER_FACTOR * 100);
  }
  return outerHipWidthM * 0.76;
}

/**
 * Derives body outer shoulder width in meters.
 */
export function deriveBodyOuterShoulderWidth(
  inputOrShoulderCm?: BodyFitInput | number | null,
  _chestCm?: number | null
): number {
  if (typeof inputOrShoulderCm === 'number') {
    if (inputOrShoulderCm > 25 && inputOrShoulderCm < 65) {
      return inputOrShoulderCm / 100;
    }
    return 0.38;
  }
  const input = (inputOrShoulderCm && typeof inputOrShoulderCm === 'object') ? inputOrShoulderCm : {};
  const shoulderCm = input.userMeasurements?.shoulderWidth || input.sizingMeasurements?.shoulderWidth;
  if (shoulderCm && Number.isFinite(shoulderCm) && shoulderCm > 25 && shoulderCm < 65) {
    return shoulderCm / 100;
  }
  if (input.skeletalShoulderSpanM && Number.isFinite(input.skeletalShoulderSpanM) && input.skeletalShoulderSpanM > 0.25) {
    return input.skeletalShoulderSpanM;
  }
  return 0.38;
}

/**
 * Evaluates whether current tracking conditions permit updating the slow BodyFitState.
 */
export function canUpdateBodyFitState(input: BodyFitInput, currentState?: BodyFitState | null): boolean {
  if (currentState?.isLocked) {
    return false;
  }

  if (input.isTrackingValid === false) {
    return false;
  }

  if (input.yawRad !== undefined && Math.abs(input.yawRad) > (25 * Math.PI) / 180) {
    return false;
  }

  if (input.confidence !== undefined && input.confidence < 0.5) {
    return false;
  }

  return true;
}

/**
 * Computes or updates the stable slow BodyFitState.
 */
export function updateBodyFitState(
  input: BodyFitInput,
  prevState?: BodyFitState | null,
  nowMs: number = Date.now()
): BodyFitState {
  if (prevState && prevState.isLocked) {
    return prevState;
  }

  const { hipWidthM: rawHipWidth, source, confidence } = deriveBodyOuterHipWidthWithSource(input);
  const rawWaistWidth = deriveBodyOuterWaistWidth(input, rawHipWidth);
  const rawShoulderWidth = deriveBodyOuterShoulderWidth(input);

  if (prevState && !canUpdateBodyFitState(input, prevState)) {
    return prevState;
  }

  const shouldLock = Boolean(
    source === 'USER_SIZING' ||
    (prevState && (nowMs - prevState.lastUpdatedMs) > 1500 && confidence >= 0.7)
  );

  if (!prevState) {
    return {
      hipWidthM: rawHipWidth,
      bodyOuterHipWidthM: rawHipWidth,
      waistWidthM: rawWaistWidth,
      shoulderWidthM: rawShoulderWidth,
      bodyOuterShoulderWidthM: rawShoulderWidth,
      skeletalHipSpanM: input.skeletalHipSpanM ?? undefined,
      upperThighWidthM: rawHipWidth * 0.82,
      bodyDepthM: rawHipWidth * HIP_DEPTH_TO_WIDTH_RATIO,
      confidence,
      lastUpdatedMs: nowMs,
      source,
      isLocked: shouldLock,
    };
  }

  const alpha = 0.15;
  const smoothedHip = prevState.hipWidthM + (rawHipWidth - prevState.hipWidthM) * alpha;
  const smoothedWaist = prevState.waistWidthM + (rawWaistWidth - prevState.waistWidthM) * alpha;
  const smoothedShoulder = prevState.shoulderWidthM + (rawShoulderWidth - prevState.shoulderWidthM) * alpha;

  return {
    hipWidthM: smoothedHip,
    bodyOuterHipWidthM: smoothedHip,
    waistWidthM: smoothedWaist,
    shoulderWidthM: smoothedShoulder,
    bodyOuterShoulderWidthM: smoothedShoulder,
    skeletalHipSpanM: input.skeletalHipSpanM ?? prevState.skeletalHipSpanM,
    upperThighWidthM: smoothedHip * 0.82,
    bodyDepthM: smoothedHip * HIP_DEPTH_TO_WIDTH_RATIO,
    confidence: Math.max(prevState.confidence, confidence),
    lastUpdatedMs: nowMs,
    source,
    isLocked: shouldLock,
  };
}

export interface EstimateBodyFitParams {
  userMeasurements?: UserMeasurements | null;
  sizingMeasurements?: {
    shoulderWidth?: number;
    hips?: number;
    waist?: number;
    height?: number;
  } | null;
  skeletalLandmarks?: Array<{ x: number; y: number; z?: number }> | null;
  torsoYawRad?: number;
  trackingConfidence?: number;
  priorState?: BodyFitState | null;
  statureM?: number | null;
}

/**
 * Top-level convenience estimator for the AR try-on loop.
 */
export function estimateBodyFitState(params: EstimateBodyFitParams): BodyFitState {
  const skeletalHipSpanM = params.skeletalLandmarks ? calculateSkeletalHipSpan(params.skeletalLandmarks) : undefined;
  const skeletalShoulderSpanM = params.skeletalLandmarks ? calculateSkeletalShoulderSpan(params.skeletalLandmarks) : undefined;

  const input: BodyFitInput = {
    userMeasurements: params.userMeasurements,
    sizingMeasurements: params.sizingMeasurements,
    skeletalHipSpanM,
    skeletalShoulderSpanM,
    yawRad: params.torsoYawRad,
    confidence: params.trackingConfidence,
    isTrackingValid: params.trackingConfidence !== undefined ? params.trackingConfidence > 0.3 : true,
    statureM: params.statureM,
  };

  return updateBodyFitState(input, params.priorState);
}
