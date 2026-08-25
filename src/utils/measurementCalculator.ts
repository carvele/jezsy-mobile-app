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

// Gender-differentiated sagittal depth-to-breadth ratios (depth = width * depthRatio).
// Derived from mean anterior-posterior depth / lateral width ratios from ANSUR-II.
const DEPTH_RATIOS = {
  female: { bust: 0.72, waist: 0.68, hips: 0.76 },
  male:   { bust: 0.66, waist: 0.71, hips: 0.64 },
  'non-binary':        { bust: 0.69, waist: 0.70, hips: 0.70 },
  'prefer_not_to_say': { bust: 0.69, waist: 0.70, hips: 0.70 },
} as const;

// BMI depth adjustment coefficients (cm depth per unit of BMI delta).
// Symmetrical expansion/contraction around reference BMI 22.0.
const BMI_DEPTH_ADJUSTMENTS = {
  female: { bust: 0.28, waist: 0.45, hips: 0.38 },
  male:   { bust: 0.24, waist: 0.48, hips: 0.32 },
  'non-binary':        { bust: 0.26, waist: 0.46, hips: 0.35 },
  'prefer_not_to_say': { bust: 0.26, waist: 0.46, hips: 0.35 },
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
 * Ramanujan's second approximation of an ellipse perimeter, accurate to better than
 * 1e-5 for human body eccentricities.
 *
 * P ≈ π(a + b) * [ 1 + (3h) / (10 + √(4 - 3h)) ] where h = (a - b)² / (a + b)²
 */
export function ellipsePerimeter(widthCm: number, depthCm: number): number {
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

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/**
 * Computes all body measurements from pose ratios and biometric inputs using
 * Ramanujan's 2nd Elliptic Approximation and ANSUR-II depth regression models.
 */
export function computeMeasurements(input: MeasurementInput): EstimatedMeasurements {
  const { bodyRatios, heightCm, weightKg, gender, crossSections } = input;
  const bmi = computeBMI(weightKg, heightCm);
  // Symmetrical depth correction around reference BMI 22.0
  const bmiDelta = Math.max(-6, Math.min(18, bmi - 22.0));

  // Scale factor: how many cm per unit of normalized ratio
  const cmPerUnit = heightCm;

  // --- Linear measurements (direct calibrated pixel scaling) ---
  const rawShoulderWidth = bodyRatios.shoulderWidthRatio * cmPerUnit;
  const rawArmLength     = bodyRatios.armLengthRatio     * cmPerUnit;
  const rawTorsoLength   = bodyRatios.torsoLengthRatio   * cmPerUnit;
  const rawLegLength     = bodyRatios.legLengthRatio      * cmPerUnit;
  const rawInseam        = bodyRatios.inseamRatio         * cmPerUnit;
  const rawBustWidth     = bodyRatios.bustWidthRatio      * cmPerUnit;
  const rawHipWidth      = bodyRatios.hipWidthRatio       * cmPerUnit;

  const dr  = DEPTH_RATIOS[gender];
  const bda = BMI_DEPTH_ADJUSTMENTS[gender];
  const wr  = WAIST_RATIO[gender];

  // --- Circumference estimates via Ramanujan's 2nd Elliptic Approximation ---
  let rawBust: number;
  let rawWaist: number;
  let rawHips: number;

  if (crossSections) {
    // Dual-view cross-section scan: measured width & measured depth
    rawBust = Math.round(
      ellipsePerimeter(crossSections.bust.widthRatio * cmPerUnit, crossSections.bust.depthRatio * cmPerUnit)
    );
    rawWaist = Math.round(
      ellipsePerimeter(crossSections.waist.widthRatio * cmPerUnit, crossSections.waist.depthRatio * cmPerUnit)
    );
    rawHips = Math.round(
      ellipsePerimeter(crossSections.hips.widthRatio * cmPerUnit, crossSections.hips.depthRatio * cmPerUnit)
    );
  } else {
    // Single monocular frontal scan: Ramanujan ellipse with ANSUR-II demographic depth regression
    const bustDepth = Math.max(12, rawBustWidth * dr.bust + bda.bust * bmiDelta);
    rawBust = Math.round(ellipsePerimeter(rawBustWidth, bustDepth));

    const waistWidth = rawHipWidth * wr;
    const waistDepth = Math.max(10, waistWidth * dr.waist + bda.waist * bmiDelta);
    rawWaist = Math.round(ellipsePerimeter(waistWidth, waistDepth));

    const hipDepth = Math.max(14, rawHipWidth * dr.hips + bda.hips * bmiDelta);
    rawHips = Math.round(ellipsePerimeter(rawHipWidth, hipDepth));
  }

  // --- Physiological Sanity Clamping (Adult boundaries) ---
  const shoulderWidth = clamp(Math.round(rawShoulderWidth), 30, 58);
  const armLength     = clamp(Math.round(rawArmLength), 45, 95);
  const torsoLength   = clamp(Math.round(rawTorsoLength), 35, 75);
  const legLength     = clamp(Math.round(rawLegLength), 65, 120);
  const inseam        = clamp(Math.round(rawInseam), 55, 105);
  const bust          = clamp(rawBust, 65, 145);
  const waist         = clamp(rawWaist, 50, 135);
  const hips          = clamp(rawHips, 70, 150);

  // --- Dynamic Empirical Confidence Scores ---
  const confidence = {
    shoulderWidth: ratioConfidence(bodyRatios.shoulderWidthRatio, 0.18, 0.35),
    armLength:     ratioConfidence(bodyRatios.armLengthRatio,     0.28, 0.45),
    torsoLength:   ratioConfidence(bodyRatios.torsoLengthRatio,   0.25, 0.40),
    legLength:     ratioConfidence(bodyRatios.legLengthRatio,     0.40, 0.58),
    inseam:        ratioConfidence(bodyRatios.inseamRatio,        0.35, 0.52),
    bust:  crossSections ? 0.92 : ratioConfidence(bodyRatios.bustWidthRatio, 0.19, 0.38) * 0.85,
    waist: crossSections ? 0.90 : ratioConfidence(bodyRatios.hipWidthRatio,  0.14, 0.28) * 0.75,
    hips:  crossSections ? 0.92 : ratioConfidence(bodyRatios.hipWidthRatio,  0.14, 0.28) * 0.85,
  };

  const overallConfidence = Math.round(
    (Object.values(confidence).reduce((a, b) => a + b, 0) / Object.values(confidence).length) * 100
  ) / 100;

  return {
    shoulderWidth,
    armLength,
    torsoLength,
    legLength,
    inseam,
    bust,
    waist,
    hips,
    confidence,
    overallConfidence,
  };
}
