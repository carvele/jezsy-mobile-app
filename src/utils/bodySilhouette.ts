import type { UserMeasurements } from './sizeRecommender';

export interface BodySilhouetteParams {
  shoulderWidthRatio: number;   // normalized ratio to standard (1.0 = baseline 124px width)
  bustWidthRatio: number;       // normalized ratio (1.0 = baseline 186px width)
  waistWidthRatio: number;      // normalized ratio (1.0 = baseline 126px width)
  hipWidthRatio: number;        // normalized ratio (1.0 = baseline 168px width)
  torsoHeightRatio: number;     // vertical stretch of torso
  bustApexY: number;            // vertical position of bust apex
  waistY: number;               // vertical position of narrowest waist
  hipY: number;                 // vertical position of hip baseline
  isCustomProportioned?: boolean;
}

/**
 * Standard baseline measurements for female couture dress-form (size M/8) in cm:
 * - Height: 168 cm
 * - Shoulder width: 38 cm
 * - Bust: 88 cm (circumference) -> width approx 28 cm
 * - Waist: 68 cm (circumference) -> width approx 22 cm
 * - Hips: 94 cm (circumference) -> width approx 30 cm
 * - Torso length: 40 cm
 */
export const COUTURE_BASELINE = {
  heightCm: 168,
  shoulderWidth: 38,
  bust: 88,
  waist: 68,
  hips: 94,
  torsoLength: 40,
};

/**
 * Converts user's cm measurements into normalized scaling parameters for the SVG mannequin paths.
 * Clamps ratios between 0.70x and 1.35x to preserve elegant couture aesthetic while matching real proportions.
 */
export function buildSilhouetteParams(
  measurements: UserMeasurements | null | undefined,
  heightCm?: number | null
): BodySilhouetteParams {
  if (!measurements || (!measurements.bust && !measurements.waist && !measurements.hips && !measurements.shoulderWidth)) {
    return {
      shoulderWidthRatio: 1.0,
      bustWidthRatio: 1.0,
      waistWidthRatio: 1.0,
      hipWidthRatio: 1.0,
      torsoHeightRatio: 1.0,
      bustApexY: 122,
      waistY: 174,
      hipY: 226,
      isCustomProportioned: false,
    };
  }

  const clamp = (val: number, min = 0.72, max = 1.32) => Math.max(min, Math.min(max, val));

  // Ratios compared to baseline female couture dress form
  const shoulderRatio = measurements.shoulderWidth
    ? clamp(measurements.shoulderWidth / COUTURE_BASELINE.shoulderWidth)
    : 1.0;

  const bustRatio = measurements.bust
    ? clamp(measurements.bust / COUTURE_BASELINE.bust)
    : (measurements.waist ? clamp((measurements.waist + 20) / COUTURE_BASELINE.bust) : 1.0);

  const waistRatio = measurements.waist
    ? clamp(measurements.waist / COUTURE_BASELINE.waist)
    : (measurements.bust ? clamp((measurements.bust - 20) / COUTURE_BASELINE.waist) : 1.0);

  const hipRatio = measurements.hips
    ? clamp(measurements.hips / COUTURE_BASELINE.hips)
    : (measurements.waist ? clamp((measurements.waist + 26) / COUTURE_BASELINE.hips) : 1.0);

  const torsoRatio = measurements.torsoLength
    ? clamp(measurements.torsoLength / COUTURE_BASELINE.torsoLength, 0.88, 1.18)
    : (heightCm ? clamp(heightCm / COUTURE_BASELINE.heightCm, 0.90, 1.15) : 1.0);

  // Dynamic vertical anchor points based on torso length
  const baseTorsoSpan = 162; // from y=88 (neck base) to y=250 (bottom trim)
  const adjustedSpan = baseTorsoSpan * torsoRatio;

  const bustApexY = 88 + adjustedSpan * 0.21;
  const waistY = 88 + adjustedSpan * 0.53;
  const hipY = 88 + adjustedSpan * 0.85;

  return {
    shoulderWidthRatio: shoulderRatio,
    bustWidthRatio: bustRatio,
    waistWidthRatio: waistRatio,
    hipWidthRatio: hipRatio,
    torsoHeightRatio: torsoRatio,
    bustApexY,
    waistY,
    hipY,
    isCustomProportioned: true,
  };
}
