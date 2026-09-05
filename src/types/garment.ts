import type { Vec3 } from './pose';

export type GarmentCategory = 'shirt' | 'dress' | 'jacket' | 'pants' | 'skirt';

export interface GarmentFitProfile {
  category: GarmentCategory;

  anchors: {
    neck?: Vec3;
    leftShoulder?: Vec3;
    rightShoulder?: Vec3;
    leftHip?: Vec3;
    rightHip?: Vec3;
    waist?: Vec3;
  };

  dimensions: {
    shoulderWidth: number;
    chestWidth: number;
    waistWidth?: number;
    length: number;
    sleeveLength?: number;
  };

  rig?: {
    skeletonUrl: string;
    meshUrl: string;
  };
}

/**
 * `AR_READY` means this garment's calibration (boneMap, anatomicalAnchorOffset,
 * restPoseMetricWidth) came from real ingestion and can be trusted for a real render.
 * The other DB-side values mean ingestion is incomplete for this garment.
 *
 * `DEMO_RIG` is client-only and never stored: it marks the synthetic fallback metadata
 * the AR screen invents when a garment has no usable calibration. It exists because the
 * fallback used to stamp itself `AR_READY`, so that value meant either "calibrated" or
 * "invented defaults" depending on React state that nothing downstream could see --
 * ar-system-contract.md section 9 carried a standing rule that no code may treat
 * `AR_READY` as proof of calibration precisely because of this. With `DEMO_RIG` the two
 * are distinguishable from the metadata alone, and that rule is retired.
 */
export type IngestionStatus =
  | 'AR_READY'
  | 'NEEDS_MERCHANT_MAPPING'
  | 'NOT_AR_COMPATIBLE'
  | 'NEEDS_CALIBRATION'
  | 'DEMO_RIG';

export interface GarmentMetadata {
  id: string;
  category: GarmentCategory;
  
  // Phase 5 Calibration Data
  calibrationVersion: string;
  ingestionStatus: IngestionStatus;
  
  // Predictable offset from the garment's origin to the anatomical anchor (e.g. neck)
  anatomicalAnchorOffset: Vec3;
  anchorConfidence: 'detected' | 'inferred' | 'merchant_confirmed';
  anchorType: 'NECK' | 'SHOULDER_CENTER' | 'CHEST' | 'WAIST' | 'HIP' | 'CUSTOM';
  
  // Baseline metric width in meters (e.g. shoulder-to-shoulder in rest pose)
  restPoseMetricWidth: number;
  
  // Mapping of arbitrary GLB bone names to our standard canonical rig
  boneMap: Record<string, string>;
  
  // Whether this garment is modeled in T-pose or A-pose
  restPose: 'T_POSE' | 'A_POSE' | 'CUSTOM';
}
