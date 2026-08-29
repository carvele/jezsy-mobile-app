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
    shoulderWidth?: number;
  }
};

export type FitVerdict = 'too_tight' | 'snug' | 'fitted' | 'relaxed' | 'roomy';

export type FitZone = {
  zone: 'Bust' | 'Waist' | 'Hips' | 'Shoulders' | 'Inseam';
  verdict: FitVerdict;
  deltaCm: number;
  description: string;
  userCm: number;
  garmentCm: number;
};

export function toNumeric(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'object' && val !== null && typeof val.valueCm === 'number') return isNaN(val.valueCm) ? null : val.valueCm;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares the user's measurements against a garment size chart and
 * produces transparent zone-by-zone fit verdicts.
 */
export function analyzeFit(
  user: UserMeasurements | null | undefined,
  garment: { bust?: number; waist?: number; hips?: number; inseam?: number; shoulderWidth?: number } | null | undefined
): FitZone[] {
  if (!garment || !user) return [];
  const zones: FitZone[] = [];

  const classify = (
    zone: FitZone['zone'],
    uRaw?: any,
    gRaw?: any,
    customEaseThresholds = { snug: 1, fitted: 6, relaxed: 10 }
  ) => {
    const u = toNumeric(uRaw);
    const g = toNumeric(gRaw);
    if (u === null || g === null) return;
    const delta = g - u; // positive = garment roomier than body

    let verdict: FitVerdict = 'fitted';
    let description = 'Ideal comfort fit';

    if (delta < 0) {
      verdict = 'too_tight';
      description = `${Math.abs(Math.round(delta))} cm smaller than body (tight)`;
    } else if (delta < customEaseThresholds.snug) {
      verdict = 'snug';
      description = `Form-fitting (+${Math.round(delta)} cm ease)`;
    } else if (delta <= customEaseThresholds.fitted) {
      verdict = 'fitted';
      description = `Tailored fit (+${Math.round(delta)} cm ease)`;
    } else if (delta <= customEaseThresholds.relaxed) {
      verdict = 'relaxed';
      description = `Comfortable ease (+${Math.round(delta)} cm ease)`;
    } else {
      verdict = 'roomy';
      description = `Oversized / Roomy (+${Math.round(delta)} cm ease)`;
    }

    zones.push({
      zone,
      verdict,
      deltaCm: Math.round(delta * 10) / 10,
      description,
      userCm: Math.round(u * 10) / 10,
      garmentCm: Math.round(g * 10) / 10,
    });
  };

  classify('Bust', user.bust, garment.bust, { snug: 2, fitted: 6, relaxed: 10 });
  classify('Waist', user.waist, garment.waist, { snug: 2, fitted: 6, relaxed: 12 });
  classify('Hips', user.hips, garment.hips, { snug: 2, fitted: 7, relaxed: 14 });
  classify('Shoulders', user.shoulderWidth, garment.shoulderWidth, { snug: 1, fitted: 4, relaxed: 8 });

  return zones;
}

/**
 * Recommends the optimal garment size based on user measurements, garment category, and fit preference.
 */
export function recommendSize(
  userMeasurements: UserMeasurements,
  productMeasurements: ProductMeasurements | null | undefined,
  fitPreference: string = 'regular',
  category?: string | null
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

  const cat = (category || '').toLowerCase();
  const isTopOrOuterwear = cat.includes('top') || cat.includes('blazer') || cat.includes('jacket') || cat.includes('shirt') || cat.includes('outerwear') || cat.includes('bra') || cat.includes('activewear');
  const isBottom = cat.includes('bottom') || cat.includes('pant') || cat.includes('jean') || cat.includes('skirt') || cat.includes('short') || cat.includes('trouser');
  const isDress = cat.includes('dress') || cat.includes('jumpsuit') || cat.includes('romper') || cat.includes('gown');

  // Baseline allowances (cm) by preference
  let allowance = 2; // Default for regular
  if (fitPreference === 'tight') allowance = 0;
  if (fitPreference === 'loose') allowance = 5;

  // Outerwear (blazers/jackets) naturally requires extra ease (3–5 cm) for comfortable layering
  if (isTopOrOuterwear && (cat.includes('blazer') || cat.includes('jacket') || cat.includes('outerwear'))) {
    allowance += 2;
  }

  let bestSize = null;
  let minWeightedScore = Infinity;

  for (const [size, metrics] of Object.entries(productMeasurements)) {
    let weightedDiffSum = 0;
    let totalWeight = 0;
    let strictlyTooSmall = false;

    const gBust = toNumeric(metrics.bust);
    const gWaist = toNumeric(metrics.waist);
    const gHips = toNumeric(metrics.hips);
    const gInseam = toNumeric(metrics.inseam);
    const gShoulder = toNumeric((metrics as any).shoulderWidth);

    // 1. Bust matching
    if (uBust !== null && gBust !== null) {
      const weight = isBottom ? 0 : (isTopOrOuterwear ? 1.0 : (isDress ? 1.0 : 0.8));
      if (weight > 0) {
        const targetBust = uBust + allowance;
        if (gBust < uBust - 1) strictlyTooSmall = true; // Garment cannot be smaller than body
        weightedDiffSum += Math.abs(gBust - targetBust) * weight;
        totalWeight += weight;
      }
    }

    // 2. Waist matching
    if (uWaist !== null && gWaist !== null) {
      const weight = isBottom ? 1.0 : (isDress ? 0.9 : (isTopOrOuterwear ? 0.35 : 0.6));
      if (weight > 0) {
        const targetWaist = uWaist + allowance;
        if (gWaist < uWaist - 1 && isBottom) strictlyTooSmall = true; // Pants must close at waist
        weightedDiffSum += Math.abs(gWaist - targetWaist) * weight;
        totalWeight += weight;
      }
    }

    // 3. Hips matching
    if (uHips !== null && gHips !== null) {
      // For tops/blazers, hips are only relevant if user's hips exceed garment hips; otherwise hips shouldn't distort jacket sizing
      const weight = isBottom ? 1.0 : (isDress ? 0.9 : (isTopOrOuterwear ? 0.1 : 0.5));
      if (weight > 0) {
        const targetHips = uHips + allowance;
        if (gHips < uHips - 1 && (isBottom || isDress)) strictlyTooSmall = true;
        weightedDiffSum += Math.abs(gHips - targetHips) * weight;
        totalWeight += weight;
      }
    }

    // 4. Inseam matching (for bottoms)
    if (uInseam !== null && gInseam !== null && isBottom) {
      const weight = 0.5;
      const targetInseam = uInseam;
      if (gInseam < uInseam - 3) strictlyTooSmall = true;
      weightedDiffSum += Math.abs(gInseam - targetInseam) * weight;
      totalWeight += weight;
    }

    // 5. Shoulder width matching (for tops/jackets)
    if (uShoulder !== null && gShoulder !== null && isTopOrOuterwear) {
      const weight = 0.75;
      const targetShoulder = uShoulder + (allowance * 0.5);
      if (gShoulder < uShoulder - 1.5) strictlyTooSmall = true;
      weightedDiffSum += Math.abs(gShoulder - targetShoulder) * weight;
      totalWeight += weight;
    }

    // Score evaluation
    if (!strictlyTooSmall && totalWeight > 0) {
      const avgScore = weightedDiffSum / totalWeight;
      if (avgScore < minWeightedScore) {
        minWeightedScore = avgScore;
        bestSize = size;
      }
    }
  }

  return bestSize;
}
