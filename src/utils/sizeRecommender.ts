export type UserMeasurements = {
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  inseam?: number | null;
  shoulderWidth?: number | null;
  armLength?: number | null;
  torsoLength?: number | null;
  legLength?: number | null;
};

export type ProductMeasurements = {
  [size: string]: {
    bust?: number;
    waist?: number;
    hips?: number;
    inseam?: number;
    length?: number;
  }
};

/**
 * Recommends a size based on user measurements and product size chart.
 * 
 * @param userMeasurements The user's detailed measurements (bust, waist, hips, inseam, etc.)
 * @param productMeasurements A dictionary mapping sizes (e.g. 'S', 'M', 'L') to garment measurements
 * @param fitPreference 'tight', 'regular', or 'loose'
 * @returns The recommended size string or null if not enough data
 */
export function recommendSize(
  userMeasurements: UserMeasurements,
  productMeasurements: ProductMeasurements | null | undefined,
  fitPreference: string = 'regular'
): string | null {
  if (!productMeasurements) return null;
  
  // We need at least one primary user measurement to make a recommendation
  if (!userMeasurements.bust && !userMeasurements.waist && !userMeasurements.hips) {
    return null;
  }

  let bestSize = null;
  let minDifference = Infinity;

  // Fit allowance (cm) based on preference
  // Tight: exact or slightly smaller
  // Regular: 2-4 cm allowance
  // Loose: 5-8 cm allowance
  let allowance = 2; // Default for regular
  if (fitPreference === 'tight') allowance = 0;
  if (fitPreference === 'loose') allowance = 6;

  for (const [size, metrics] of Object.entries(productMeasurements)) {
    let diffSum = 0;
    let matchCount = 0;
    let tooSmall = false;

    // Compare available metrics
    if (userMeasurements.bust && metrics.bust) {
      const targetBust = userMeasurements.bust + allowance;
      if (metrics.bust < userMeasurements.bust - 1) tooSmall = true; // Garment smaller than body
      diffSum += Math.abs(metrics.bust - targetBust);
      matchCount++;
    }

    if (userMeasurements.waist && metrics.waist) {
      const targetWaist = userMeasurements.waist + allowance;
      if (metrics.waist < userMeasurements.waist - 1) tooSmall = true;
      diffSum += Math.abs(metrics.waist - targetWaist);
      matchCount++;
    }

    if (userMeasurements.hips && metrics.hips) {
      const targetHips = userMeasurements.hips + allowance;
      if (metrics.hips < userMeasurements.hips - 1) tooSmall = true;
      diffSum += Math.abs(metrics.hips - targetHips);
      matchCount++;
    }

    if (userMeasurements.inseam && metrics.inseam) {
      const targetInseam = userMeasurements.inseam; // Inseam doesn't need horizontal allowance
      if (metrics.inseam < userMeasurements.inseam - 2) tooSmall = true; // Too short
      diffSum += Math.abs(metrics.inseam - targetInseam);
      matchCount++;
    }

    // Only consider this size if it didn't strictly fail constraints and we matched at least one metric
    if (!tooSmall && matchCount > 0) {
      const avgDiff = diffSum / matchCount;
      if (avgDiff < minDifference) {
        minDifference = avgDiff;
        bestSize = size;
      }
    }
  }

  return bestSize;
}
