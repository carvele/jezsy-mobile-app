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
export type FabricStretch = 'Rigid' | 'Moderate' | 'High';

export function analyzeFit(
  user: UserMeasurements | null | undefined,
  garment: { bust?: number; waist?: number; hips?: number; inseam?: number; shoulderWidth?: number; stretch?: FabricStretch } | null | undefined
): FitZone[] {
  if (!garment || !user) return [];
  const zones: FitZone[] = [];

  const classify = (
    zone: FitZone['zone'],
    uRaw?: any,
    gRaw?: any,
    baseEaseThresholds = { snug: 1, fitted: 6, relaxed: 10 }
  ) => {
    // Dynamic stretch mechanics:
    // Rigid fabrics (like denim) need more ease to not feel tight.
    // High stretch fabrics (like spandex) can have negative ease and still fit perfectly.
    const customEaseThresholds = { ...baseEaseThresholds };
    if (garment.stretch === 'Rigid') {
      customEaseThresholds.snug += 2;
      customEaseThresholds.fitted += 2;
    } else if (garment.stretch === 'High') {
      customEaseThresholds.snug -= 3;
      customEaseThresholds.fitted -= 3;
    }

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

// --- Length fit signal (roadmap Phase 3) ---------------------------------
// Feedback only: does not affect garment scale, which stays uniform (see
// ar-system-contract.md's fit-model boundary -- "this garment worn on this
// body" is explicitly out of model). Compares the selected size's chart
// length against the wearer's own torso length, tracked live from the
// current AR frame's world landmarks (shoulder midpoint to hip midpoint) --
// the same midpoint pair poseNormalizer.ts already computes for the torso
// basis, reused here rather than a new measurement model.
//
// Torso length (shoulder-to-hip) is a proxy for garment length, not the
// garment's own collar-to-hem span -- there is no tracked collar or hem
// point, so a garment is EXPECTED to exceed pure torso length by some
// margin just to cover the hip. LENGTH_TYPICAL_HIP_DROP_CM names that
// expected margin explicitly, the same way STATURE_CORRECTION in
// poseDetector.ts names its own generic, not-measured-on-this-app's-users
// constant -- replace with real reference data if it becomes available,
// not by silently tuning the number.
export type LengthFitVerdict = 'runs_short' | 'appropriate' | 'runs_long';

export interface LengthFitSignal {
  verdict: LengthFitVerdict;
  deltaCm: number;
  chartLengthCm: number;
  trackedTorsoLengthCm: number;
}

/** Rough allowance: a garment is expected to extend past the shoulder-to-hip
 * torso span by about this much to cover the hip. Not measured on this
 * catalog or this app's users -- a placeholder in the same spirit as
 * STATURE_CORRECTION until real reference data exists. */
const LENGTH_TYPICAL_HIP_DROP_CM = 20;
/** Width of the "appropriate" band around that expected drop. Deliberately
 * wide: torso length is a proxy, not the garment's own measured dimension,
 * so a tight band would read as noise-sensitive rather than informative. */
const LENGTH_EASE_CM = 15;

const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_HIP = 23;
const LM_RIGHT_HIP = 24;

/**
 * Live length-fit signal from the current AR frame's world landmarks.
 * Returns null whenever there isn't enough real data to say anything --
 * never a guessed verdict.
 */
export function computeLengthFitSignal(
  worldLandmarks: readonly ({ x: number; y: number; z?: number } | null | undefined)[] | null | undefined,
  chartLengthCm: number | null | undefined
): LengthFitSignal | null {
  const chartLength = toNumeric(chartLengthCm);
  if (chartLength === null || chartLength <= 0) return null;
  if (!worldLandmarks || worldLandmarks.length <= LM_RIGHT_HIP) return null;

  const lS = worldLandmarks[LM_LEFT_SHOULDER];
  const rS = worldLandmarks[LM_RIGHT_SHOULDER];
  const lH = worldLandmarks[LM_LEFT_HIP];
  const rH = worldLandmarks[LM_RIGHT_HIP];
  if (!lS || !rS || !lH || !rH) return null;

  const midShoulder = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2, z: ((lS.z ?? 0) + (rS.z ?? 0)) / 2 };
  const midHip = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2, z: ((lH.z ?? 0) + (rH.z ?? 0)) / 2 };
  const dx = midShoulder.x - midHip.x;
  const dy = midShoulder.y - midHip.y;
  const dz = midShoulder.z - midHip.z;
  const torsoLengthM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(torsoLengthM) || torsoLengthM <= 0) return null;

  const trackedTorsoLengthCm = torsoLengthM * 100;
  const targetLengthCm = trackedTorsoLengthCm + LENGTH_TYPICAL_HIP_DROP_CM;
  const deltaCm = Math.round((chartLength - targetLengthCm) * 10) / 10;

  let verdict: LengthFitVerdict = 'appropriate';
  if (deltaCm < -LENGTH_EASE_CM) verdict = 'runs_short';
  else if (deltaCm > LENGTH_EASE_CM) verdict = 'runs_long';

  return {
    verdict,
    deltaCm,
    chartLengthCm: Math.round(chartLength * 10) / 10,
    trackedTorsoLengthCm: Math.round(trackedTorsoLengthCm * 10) / 10,
  };
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

