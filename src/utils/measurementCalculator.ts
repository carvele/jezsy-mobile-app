import type { BodyRatios, WorldLandmark } from './poseDetector';

export type Gender = 'male' | 'female' | 'non-binary' | 'prefer_not_to_say';

export interface CrossSection {
  widthRatio: number;
  depthRatio: number;
}

export interface MeasurementInput {
  bodyRatios: BodyRatios;
  heightCm: number;
  weightKg: number;
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

export type MeasurementEstimate = {
  valueCm: number;
  uncertaintyCm: number;
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

/**
 * Computes all body measurements from pose ratios and cross-sections.
 */
export function computeMeasurements(input: MeasurementInput): EstimatedMeasurements {
  const { bodyRatios, heightCm, crossSections, worldLandmarks } = input;
  
  // Base linear scale (pixels to cm) calibrated entirely on user height
  const cmPerUnit = heightCm;

  // --- Linear measurements (direct calibrated pixel scaling or metric 3D points) ---
  const linearUncertainty = worldLandmarks ? 1.5 : 3.5;

  const getLinearFallback = (ratio: number): MeasurementEstimate => ({
    valueCm: Math.round(ratio * cmPerUnit * 10) / 10,
    uncertaintyCm: linearUncertainty
  });

  const getMetricDistance = (idxA: number, idxB: number, fallbackRatio: number): MeasurementEstimate => {
    if (worldLandmarks && worldLandmarks[idxA] && worldLandmarks[idxB]) {
      const p1 = worldLandmarks[idxA];
      const p2 = worldLandmarks[idxB];
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dz = p1.z - p2.z;
      // World landmarks are in meters, convert to cm
      const distCm = Math.sqrt(dx*dx + dy*dy + dz*dz) * 100;
      return { valueCm: Math.round(distCm * 10) / 10, uncertaintyCm: linearUncertainty };
    }
    return getLinearFallback(fallbackRatio);
  };

  const shoulderWidth = getMetricDistance(11, 12, bodyRatios.shoulderWidthRatio);
  const armLength = getMetricDistance(12, 16, bodyRatios.armLengthRatio); // Right shoulder to right wrist
  const torsoLength = getMetricDistance(11, 23, bodyRatios.torsoLengthRatio); // Left shoulder to left hip
  const legLength = getMetricDistance(23, 27, bodyRatios.legLengthRatio); // Left hip to left ankle
  const inseam = getLinearFallback(bodyRatios.inseamRatio);

  // --- Circumference estimates ---
  let bust: MeasurementEstimate;
  let waist: MeasurementEstimate;
  let hips: MeasurementEstimate;

  if (crossSections) {
    // Primary Pipeline: Dual-view cross-section scan (measured width & measured depth)
    const baseUncertainty = 4.8; // Elliptical assumption error + depth/segmentation noise
    bust = {
      valueCm: Math.round(ellipsePerimeter(crossSections.bust.widthRatio * cmPerUnit, crossSections.bust.depthRatio * cmPerUnit)),
      uncertaintyCm: baseUncertainty
    };
    waist = {
      valueCm: Math.round(ellipsePerimeter(crossSections.waist.widthRatio * cmPerUnit, crossSections.waist.depthRatio * cmPerUnit)),
      uncertaintyCm: baseUncertainty
    };
    hips = {
      valueCm: Math.round(ellipsePerimeter(crossSections.hips.widthRatio * cmPerUnit, crossSections.hips.depthRatio * cmPerUnit)),
      uncertaintyCm: baseUncertainty
    };
  } else {
    // Fallback: Single-view with anthropometrically calibrated depth ratios
    const extremeUncertainty = input.gender === 'female' ? 8.5 : 10.0;
    
    // Anthropometric depth-to-width ratios by gender
    const depthRatios = input.gender === 'female'
      ? { bust: 0.68, waist: 0.72, hips: 0.75 }
      : input.gender === 'male'
      ? { bust: 0.80, waist: 0.78, hips: 0.72 }
      : { bust: 0.70, waist: 0.74, hips: 0.73 };

    const rawBustWidth = bodyRatios.bustWidthRatio * cmPerUnit;
    bust = {
      valueCm: Math.round(ellipsePerimeter(rawBustWidth, rawBustWidth * depthRatios.bust) * 10) / 10,
      uncertaintyCm: extremeUncertainty
    };
    
    const rawHipWidth = bodyRatios.hipWidthRatio * cmPerUnit;
    hips = {
      valueCm: Math.round(ellipsePerimeter(rawHipWidth, rawHipWidth * depthRatios.hips) * 10) / 10,
      uncertaintyCm: extremeUncertainty
    };
    
    // Waist width derived from anatomical ratio or hip ratio
    const rawWaistWidth = bodyRatios.rawWaistWidthRatio 
      ? bodyRatios.rawWaistWidthRatio * cmPerUnit 
      : (rawHipWidth * (input.gender === 'female' ? 0.76 : 0.82));
    waist = {
      valueCm: Math.round(ellipsePerimeter(rawWaistWidth, rawWaistWidth * depthRatios.waist) * 10) / 10,
      uncertaintyCm: extremeUncertainty
    };
  }

  return {
    shoulderWidth,
    armLength,
    torsoLength,
    legLength,
    inseam,
    bust,
    waist,
    hips,
    overallConfidence: crossSections ? 0.9 : 0.4
  };
}
