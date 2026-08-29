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
export type FitVerdict = 'snug' | 'fitted' | 'roomy';
export type FitZone = { zone: 'Bust' | 'Waist' | 'Hips'; verdict: FitVerdict; deltaCm: number };

function toNumeric(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'object' && val !== null && typeof val.valueCm === 'number') return isNaN(val.valueCm) ? null : val.valueCm;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares the user's measurements against one garment size's chart and
 * classifies each zone as snug (garment smaller/equal to body), fitted (a
 * normal 1-6 cm of ease), or roomy (more than 6 cm of ease). Guidance only --
 * not a physical simulation. Returns [] when data is missing.
 */
export function analyzeFit(
  user: UserMeasurements,
  garment: { bust?: number; waist?: number; hips?: number } | null | undefined
): FitZone[] {
  if (!garment || !user) return [];
  const zones: FitZone[] = [];
  const classify = (zone: FitZone['zone'], uRaw?: any, gRaw?: any) => {
    const u = toNumeric(uRaw);
    const g = toNumeric(gRaw);
    if (u === null || g === null) return;
    const delta = g - u; // positive = garment roomier than body
    const verdict: FitVerdict = delta < 1 ? 'snug' : delta <= 6 ? 'fitted' : 'roomy';
    zones.push({ zone, verdict, deltaCm: Math.round(delta) });
  };
  classify('Bust', user.bust, garment.bust);
  classify('Waist', user.waist, garment.waist);
  classify('Hips', user.hips, garment.hips);
  return zones;
}

export function recommendSize(
  userMeasurements: UserMeasurements,
  productMeasurements: ProductMeasurements | null | undefined,
  fitPreference: string = 'regular'
): string | null {
  if (!productMeasurements || !userMeasurements) return null;
  
  const uBust = toNumeric(userMeasurements.bust);
  const uWaist = toNumeric(userMeasurements.waist);
  const uHips = toNumeric(userMeasurements.hips);
  const uInseam = toNumeric(userMeasurements.inseam);
  const uShoulder = toNumeric(userMeasurements.shoulderWidth);

  // We need at least one primary user measurement to make a recommendation
  if (!uBust && !uWaist && !uHips) {
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

    const gBust = toNumeric(metrics.bust);
    const gWaist = toNumeric(metrics.waist);
    const gHips = toNumeric(metrics.hips);
    const gInseam = toNumeric(metrics.inseam);
    const gShoulder = toNumeric((metrics as any).shoulderWidth);

    // Compare available metrics
    if (uBust !== null && gBust !== null) {
      const targetBust = uBust + allowance;
      if (gBust < uBust - 1) tooSmall = true; // Garment smaller than body
      diffSum += Math.abs(gBust - targetBust);
      matchCount++;
    }

    if (uWaist !== null && gWaist !== null) {
      const targetWaist = uWaist + allowance;
      if (gWaist < uWaist - 1) tooSmall = true;
      diffSum += Math.abs(gWaist - targetWaist);
      matchCount++;
    }

    if (uHips !== null && gHips !== null) {
      const targetHips = uHips + allowance;
      if (gHips < uHips - 1) tooSmall = true;
      diffSum += Math.abs(gHips - targetHips);
      matchCount++;
    }

    if (uInseam !== null && gInseam !== null) {
      const targetInseam = uInseam; // Inseam doesn't need horizontal allowance
      if (gInseam < uInseam - 2) tooSmall = true; // Too short
      diffSum += Math.abs(gInseam - targetInseam);
      matchCount++;
    }

    if (uShoulder !== null && gShoulder !== null) {
      const targetShoulder = uShoulder + (allowance * 0.5);
      if (gShoulder < uShoulder - 1.5) tooSmall = true;
      diffSum += Math.abs(gShoulder - targetShoulder);
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
