/**
 * Converts normalized body proportion ratios from BlazePose landmarks
 * into real-world measurements (cm) using gender-differentiated
 * anthropometric regression models.
 *
 * Regression coefficients are derived from ANSUR-II (US Army, n=6,068)
 * and CAESAR survey (n=2,400) anthropometric databases.
 *
 * Linear measurements (shoulder width, arm length, etc.) are computed
 * via direct pixel-to-cm scaling using known height as the reference.
 *
 * Circumference measurements (bust, waist, hips) are estimated via
 * validated linear regression on skeletal width + BMI correction:
 *   circumference ≈ width_cm * depth_multiplier + bmi_adjustment
 */

import type { BodyRatios } from './poseDetector';

export type Gender = 'male' | 'female' | 'non-binary' | 'prefer_not_to_say';

/**
 * Body width and depth at each circumference site, both normalized to the
 * same head-to-ankle span the ratios use. Width comes from the front scan's
 * segmentation mask, depth from the side scan's.
 */
export interface CrossSection {
  widthRatio: number;
  depthRatio: number;
}

export interface MeasurementInput {
  bodyRatios: BodyRatios;
  heightCm: number;
  weightKg: number;
  gender: Gender;
  /**
   * Present only when a side scan was completed. Without it the estimate
   * falls back to inferring depth from BMI, which is what the front-only
   * pipeline has always done.
   */
  crossSections?: {
    bust: CrossSection;
    waist: CrossSection;
    hips: CrossSection;
  };
}

export interface EstimatedMeasurements {
  // Linear measurements (cm)
  shoulderWidth: number;
  armLength: number;
  torsoLength: number;
  legLength: number;
  inseam: number;
  // Circumference estimates (cm)
  bust: number;
  waist: number;
  hips: number;
  // Per-field confidence scores (0–1)
  confidence: {
    shoulderWidth: number;
    armLength: number;
    torsoLength: number;
    legLength: number;
    inseam: number;
    bust: number;
    waist: number;
    hips: number;
  };
  // Overall scan quality
  overallConfidence: number;
}

// Gender-differentiated depth multipliers (width-to-circumference ratio).
// These approximate the elliptical cross-section of human body segments.
// Based on mean anterior-posterior depth / lateral width ratios from ANSUR-II.
const DEPTH_MULTIPLIERS = {
  female: { bust: 2.62, waist: 2.48, hips: 2.71 },
  male:   { bust: 2.45, waist: 2.55, hips: 2.40 },
  // Non-binary / prefer not to say: weighted average
  'non-binary':          { bust: 2.54, waist: 2.52, hips: 2.56 },
  'prefer_not_to_say':   { bust: 2.54, waist: 2.52, hips: 2.56 },
} as const;

// BMI adjustment coefficients for circumference correction.
// Accounts for the fact that a higher BMI adds depth disproportionately.
const BMI_ADJUSTMENTS = {
  female: { bust: 0.45, waist: 0.80, hips: 0.65 },
  male:   { bust: 0.38, waist: 0.85, hips: 0.50 },
  'non-binary':          { bust: 0.42, waist: 0.82, hips: 0.58 },
  'prefer_not_to_say':   { bust: 0.42, waist: 0.82, hips: 0.58 },
} as const;

// Waist narrows relative to hips/shoulders; this factor accounts for the
// waist-to-hip anatomical ratio as a function of hip width.
const WAIST_RATIO = {
  female: 0.72, // female waist is ~72% of hip width
  male:   0.82,
  'non-binary':        0.77,
  'prefer_not_to_say': 0.77,
} as const;

function computeBMI(weightKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

/**
 * Ramanujan's approximation of an ellipse perimeter, accurate to better than
 * 1e-5 for human body eccentricities.
 *
 * With a measured depth the cross-section is a real ellipse, so this replaces
 * the width x depth_multiplier shortcut entirely -- that multiplier existed
 * only because depth was unknown.
 */
function ellipsePerimeter(widthCm: number, depthCm: number): number {
  const a = widthCm / 2;
  const b = depthCm / 2;
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * Confidence for a linear measurement based on its ratio stability.
 * Returns higher confidence when the ratio is within expected human range.
 */
function ratioConfidence(ratio: number, expectedMin: number, expectedMax: number): number {
  if (ratio < expectedMin || ratio > expectedMax) return 0.5;
  // Linear scale within expected range → 0.85–1.0
  const midpoint = (expectedMin + expectedMax) / 2;
  const halfRange = (expectedMax - expectedMin) / 2;
  const deviation = Math.abs(ratio - midpoint) / halfRange;
  return 0.85 + (1 - deviation) * 0.15;
}

/**
 * Circumferences from measured cross-sections alone.
 *
 * Exposed so the scan can apply a side pass after the front burst has already
 * been averaged, rather than re-running the whole estimate: the linear
 * measurements are unaffected by depth and there is no reason to disturb
 * their outlier rejection.
 */
export function circumferencesFromCrossSections(
  crossSections: { bust: CrossSection; waist: CrossSection; hips: CrossSection },
  heightCm: number,
): { bust: number; waist: number; hips: number } {
  const toCm = (r: number) => r * heightCm;
  return {
    bust: Math.round(
      ellipsePerimeter(toCm(crossSections.bust.widthRatio), toCm(crossSections.bust.depthRatio)),
    ),
    waist: Math.round(
      ellipsePerimeter(toCm(crossSections.waist.widthRatio), toCm(crossSections.waist.depthRatio)),
    ),
    hips: Math.round(
      ellipsePerimeter(toCm(crossSections.hips.widthRatio), toCm(crossSections.hips.depthRatio)),
    ),
  };
}

/**
 * Computes all body measurements from pose ratios and biometric inputs.
 */
export function computeMeasurements(input: MeasurementInput): EstimatedMeasurements {
  const { bodyRatios, heightCm, weightKg, gender, crossSections } = input;
  const bmi = computeBMI(weightKg, heightCm);
  const bmiDelta = Math.max(0, bmi - 22); // deviation above normal BMI

  // Scale factor: how many cm per unit of normalized ratio
  // bodyRatios are normalized to head-to-ankle height, so 1.0 ratio = heightCm
  const cmPerUnit = heightCm;

  // --- Linear measurements (direct pixel scaling) ---
  const shoulderWidth = bodyRatios.shoulderWidthRatio * cmPerUnit;
  const armLength     = bodyRatios.armLengthRatio     * cmPerUnit;
  const torsoLength   = bodyRatios.torsoLengthRatio   * cmPerUnit;
  const legLength     = bodyRatios.legLengthRatio      * cmPerUnit;
  const inseam        = bodyRatios.inseamRatio         * cmPerUnit;
  const bustWidth     = bodyRatios.bustWidthRatio      * cmPerUnit;
  const hipWidth      = bodyRatios.hipWidthRatio       * cmPerUnit;

  const dm  = DEPTH_MULTIPLIERS[gender];
  const bma = BMI_ADJUSTMENTS[gender];
  const wr  = WAIST_RATIO[gender];

  // --- Circumference estimates ---
  // With a side scan the cross-section is measured: width from the front
  // mask, depth from the side one, and the perimeter follows directly.
  // Without one, depth is unknown and has to be inferred from width and BMI,
  // which is the older and materially weaker path.
  const measured = crossSections
    ? {
        bust: ellipsePerimeter(
          crossSections.bust.widthRatio * cmPerUnit,
          crossSections.bust.depthRatio * cmPerUnit,
        ),
        waist: ellipsePerimeter(
          crossSections.waist.widthRatio * cmPerUnit,
          crossSections.waist.depthRatio * cmPerUnit,
        ),
        hips: ellipsePerimeter(
          crossSections.hips.widthRatio * cmPerUnit,
          crossSections.hips.depthRatio * cmPerUnit,
        ),
      }
    : null;

  const bust = Math.round(
    measured?.bust || bustWidth * dm.bust + bma.bust * bmiDelta,
  );
  const waist = Math.round(
    measured?.waist || hipWidth * wr * dm.waist + bma.waist * bmiDelta,
  );
  const hips = Math.round(
    measured?.hips || hipWidth * dm.hips + bma.hips * bmiDelta,
  );

  // --- Confidence scores ---
  const confidence = {
    shoulderWidth: ratioConfidence(bodyRatios.shoulderWidthRatio, 0.18, 0.35),
    armLength:     ratioConfidence(bodyRatios.armLengthRatio,     0.28, 0.45),
    torsoLength:   ratioConfidence(bodyRatios.torsoLengthRatio,   0.25, 0.40),
    legLength:     ratioConfidence(bodyRatios.legLengthRatio,     0.40, 0.58),
    inseam:        ratioConfidence(bodyRatios.inseamRatio,        0.35, 0.52),
    // A measured cross-section is a real perimeter rather than a regression
    // on width alone, so it is scored higher. Without one the waist stays the
    // weakest figure: it is not measured at all, only derived from hip width.
    bust:  measured ? 0.95 : ratioConfidence(bodyRatios.bustWidthRatio, 0.19, 0.38),
    waist: measured ? 0.95 : ratioConfidence(bodyRatios.hipWidthRatio,  0.14, 0.28) * 0.9,
    hips:  measured ? 0.95 : ratioConfidence(bodyRatios.hipWidthRatio,  0.14, 0.28),
  };

  const overallConfidence =
    Object.values(confidence).reduce((a, b) => a + b, 0) /
    Object.values(confidence).length;

  return {
    shoulderWidth: Math.round(shoulderWidth),
    armLength:     Math.round(armLength),
    torsoLength:   Math.round(torsoLength),
    legLength:     Math.round(legLength),
    inseam:        Math.round(inseam),
    bust,
    waist,
    hips,
    confidence,
    overallConfidence,
  };
}
